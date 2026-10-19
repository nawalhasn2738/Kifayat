import { and, desc, eq, sql } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, transactions } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/types';
import type { Transaction } from '@/lib/types';
import { validateTransactionInput, type TransactionInput } from '@/lib/validation/transaction';

export type TransactionRepositoryDependencies = {
  userId: number;
  createClientId: () => string;
  now: () => Date;
};

export type OverdraftConfirmation = {
  accountId: number;
  projectedBalance: number;
};

export type TransactionMutationOptions = {
  overdraftConfirmation?: OverdraftConfirmation;
};

export class OverdraftConfirmationRequiredError extends Error {
  readonly accountId: number;
  readonly accountName: string;
  readonly projectedBalance: number;

  constructor(accountId: number, accountName: string, projectedBalance: number) {
    super(`${accountName} would have a balance of PKR ${projectedBalance}. Confirm the overdraft to continue.`);
    this.name = 'OverdraftConfirmationRequiredError';
    this.accountId = accountId;
    this.accountName = accountName;
    this.projectedBalance = projectedBalance;
  }
}

const productionDependencies: TransactionRepositoryDependencies = {
  userId: LOCAL_USER_ID,
  createClientId: () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  now: () => new Date(),
};
const legacyTransferMutationError = 'Legacy transfers cannot be updated or deleted until transfer support exists.';


const selection = {
  id: transactions.id, clientId: transactions.clientId, date: transactions.date,
  amount: transactions.amount, type: transactions.type, merchant: transactions.merchant,
  description: transactions.description, isAnomaly: transactions.isAnomaly,
  categoryId: categories.id, categoryName: categories.name,
  accountId: accounts.id, accountName: accounts.name, accountType: accounts.type,
};

export function createTransactionRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: TransactionRepositoryDependencies = productionDependencies,
) {
  function selectBase() {
    return database.select(selection).from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id));
  }

  type Selected = Awaited<ReturnType<typeof selectBase>>[number];

  function mapTransaction(row: Selected): Transaction {
    return { id: row.id, clientId: row.clientId, date: row.date, amount: row.amount, type: row.type,
      merchant: row.merchant, description: row.description, isAnomaly: row.isAnomaly,
      category: row.categoryId ? { id: row.categoryId, name: row.categoryName! } : null,
      account: { id: row.accountId, name: row.accountName, type: row.accountType } };
  }

  async function listTransactions(limit = 100) {
    return (await selectBase().where(eq(transactions.userId, dependencies.userId))
      .orderBy(desc(transactions.date)).limit(limit)).map(mapTransaction);
  }

  async function getTransaction(id: number) {
    const [row] = await selectBase().where(and(
      eq(transactions.id, id),
      eq(transactions.userId, dependencies.userId),
    )).limit(1);
    return row ? mapTransaction(row) : null;
  }

  function requireOverdraftConfirmation(
    account: { id: number; name: string },
    projectedBalance: number,
    options: TransactionMutationOptions,
  ) {
    if (projectedBalance >= 0) return;
    const confirmation = options.overdraftConfirmation;
    if (confirmation?.accountId === account.id && confirmation.projectedBalance === projectedBalance) return;
    throw new OverdraftConfirmationRequiredError(account.id, account.name, projectedBalance);
  }

  async function createTransaction(raw: TransactionInput, options: TransactionMutationOptions = {}) {
    const input = validateTransactionInput(raw);
    const signedAmount = input.type === 'income' ? input.amount : -input.amount;
    const clientId = dependencies.createClientId();
    const insertedId = database.transaction((tx) => {
      const [account] = tx.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!account) throw new Error('The selected account no longer exists.');
      if (input.type === 'expense') requireOverdraftConfirmation(account, account.balance + signedAmount, options);
      const [created] = tx.insert(transactions).values({ clientId, userId: dependencies.userId,
        accountId: input.accountId, categoryId: input.categoryId, date: new Date(input.date).toISOString(), amount: signedAmount,
        type: input.type, merchant: input.merchant || null, description: input.description || null })
        .returning({ id: transactions.id }).all();
      tx.run(sql`UPDATE accounts SET balance = balance + ${signedAmount} WHERE id = ${input.accountId}`);
      return created.id;
    });
    const created = await getTransaction(insertedId);
    if (!created) throw new Error('Transaction was saved but could not be reloaded.');
    return created;
  }

  async function updateTransaction(id: number, raw: TransactionInput, options: TransactionMutationOptions = {}) {
    const input = validateTransactionInput(raw);
    const result = database.transaction((tx) => {
      const [existing] = tx.select().from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, dependencies.userId))).limit(1).all();
      if (!existing) throw new Error('Transaction not found.');
      const [existingAccount] = tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.id, existing.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!existingAccount) throw new Error('Transaction account ownership is inconsistent.');
      if (existing.type === 'transfer') throw new Error(legacyTransferMutationError);
      const [account] = tx.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!account) throw new Error('The selected account no longer exists.');
      const signedAmount = input.type === 'income' ? input.amount : -input.amount;
      const projectedBalance = account.balance + signedAmount
        + (existing.accountId === input.accountId ? -existing.amount : 0);
      if (input.type === 'expense') requireOverdraftConfirmation(account, projectedBalance, options);
      tx.run(sql`UPDATE accounts SET balance = balance - ${existing.amount} WHERE id = ${existing.accountId}`);
      tx.update(transactions).set({ accountId: input.accountId, categoryId: input.categoryId, date: new Date(input.date).toISOString(),
        amount: signedAmount, type: input.type, merchant: input.merchant || null,
        description: input.description || null, updatedAt: dependencies.now().toISOString() })
        .where(eq(transactions.id, id)).run();
      tx.run(sql`UPDATE accounts SET balance = balance + ${signedAmount} WHERE id = ${input.accountId}`);
      return id;
    });
    return getTransaction(result);
  }

  async function deleteTransaction(id: number) {
    database.transaction((tx) => {
      const [existing] = tx.select().from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, dependencies.userId))).limit(1).all();
      if (!existing) throw new Error('Transaction not found.');
      const [existingAccount] = tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.id, existing.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!existingAccount) throw new Error('Transaction account ownership is inconsistent.');
      if (existing.type === 'transfer') throw new Error(legacyTransferMutationError);
      tx.delete(transactions).where(eq(transactions.id, id)).run();
      tx.run(sql`UPDATE accounts SET balance = balance - ${existing.amount} WHERE id = ${existing.accountId}`);
    });
  }

  return { listTransactions, getTransaction, createTransaction, updateTransaction, deleteTransaction };
}
