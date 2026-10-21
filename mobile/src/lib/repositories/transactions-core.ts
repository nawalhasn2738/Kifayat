import { and, desc, eq, sql } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, categoryApplicability, transactions } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/types';
import type { Transaction } from '@/lib/types';
import { validatePersistedTransaction, validateTransactionInput, type TransactionInput } from '@/lib/validation/transaction';

export type TransactionRepositoryDependencies = {
  userId: number;
  now: () => Date;
};

export type OverdraftConfirmation = {
  accountId: number;
  projectedBalance: number;
};

export type TransactionMutationOptions = {
  overdraftConfirmation?: OverdraftConfirmation;
};

export type TransactionCreationOptions = TransactionMutationOptions & {
  clientId: string;
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

export type CategoryApplicabilityErrorCode =
  | 'category_not_found'
  | 'category_unmapped'
  | 'category_incompatible';

const categoryApplicabilityMessages: Record<CategoryApplicabilityErrorCode, string> = {
  category_not_found: 'The selected category no longer exists.',
  category_unmapped: 'The selected category is not available for new transaction assignments.',
  category_incompatible: 'The selected category cannot be used for this transaction type.',
};

export class CategoryApplicabilityError extends Error {
  readonly code: CategoryApplicabilityErrorCode;
  readonly categoryId: number;
  readonly transactionType: TransactionInput['type'];

  constructor(code: CategoryApplicabilityErrorCode, categoryId: number, transactionType: TransactionInput['type']) {
    super(categoryApplicabilityMessages[code]);
    this.name = 'CategoryApplicabilityError';
    this.code = code;
    this.categoryId = categoryId;
    this.transactionType = transactionType;
  }
}

const productionDependencies: TransactionRepositoryDependencies = {
  userId: LOCAL_USER_ID,
  now: () => new Date(),
};
const legacyTransferMutationError = 'Legacy transfers cannot be updated or deleted until transfer support exists.';
const idempotencyConflictError = 'This transaction request ID was already used for different transaction details.';
const unsafeBalanceError = 'Account balance arithmetic requires JavaScript safe integers.';
const futureTransactionDateError = 'Future-dated income and expense transactions are not supported.';

function checkedBalanceAdd(balance: number, effect: number) {
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(effect)) throw new Error(unsafeBalanceError);
  const result = balance + effect;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeBalanceError);
  return result;
}

function checkedBalanceSubtract(balance: number, effect: number) {
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(effect)) throw new Error(unsafeBalanceError);
  const result = balance - effect;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeBalanceError);
  return result;
}

function requireSupportedEffectiveDate(date: string, now: Date, existingDate?: string) {
  if (new Date(date).getTime() > now.getTime() && date !== existingDate) {
    throw new Error(futureTransactionDateError);
  }
}


const selection = {
  id: transactions.id, clientId: transactions.clientId, userId: transactions.userId, date: transactions.date,
  amount: transactions.amount, type: transactions.type, merchant: transactions.merchant,
  description: transactions.description, isAnomaly: transactions.isAnomaly,
  categoryId: categories.id, categoryName: categories.name,
  accountId: accounts.id, accountName: accounts.name, accountType: accounts.type,
};

export function createTransactionRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: TransactionRepositoryDependencies = productionDependencies,
) {
  type TransactionContext = Parameters<Parameters<typeof database.transaction>[0]>[0];

  function requireCategoryApplicability(
    tx: TransactionContext,
    categoryId: number | null,
    transactionType: TransactionInput['type'],
  ) {
    if (categoryId === null) return;
    const [category] = tx.select({ id: categories.id }).from(categories)
      .where(eq(categories.id, categoryId)).limit(1).all();
    if (!category) throw new CategoryApplicabilityError('category_not_found', categoryId, transactionType);
    const mappings = tx.select({ transactionType: categoryApplicability.transactionType })
      .from(categoryApplicability).where(eq(categoryApplicability.categoryId, categoryId)).all();
    if (!mappings.length) throw new CategoryApplicabilityError('category_unmapped', categoryId, transactionType);
    if (!mappings.some((mapping) => mapping.transactionType === transactionType)) {
      throw new CategoryApplicabilityError('category_incompatible', categoryId, transactionType);
    }
  }

  function selectBase() {
    return database.select(selection).from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id));
  }

  type Selected = Awaited<ReturnType<typeof selectBase>>[number];

  function mapTransaction(row: Selected): Transaction {
    const valid = validatePersistedTransaction(row);
    return { id: valid.id, clientId: valid.clientId, date: valid.date, amount: valid.amount, type: valid.type,
      merchant: row.merchant, description: row.description, isAnomaly: row.isAnomaly,
      category: row.categoryId ? { id: row.categoryId, name: row.categoryName! } : null,
      account: { id: row.accountId, name: row.accountName, type: row.accountType } };
  }

  async function listTransactions(limit = 100) {
    return (await selectBase().where(eq(transactions.userId, dependencies.userId))
      .orderBy(desc(transactions.date)).limit(limit)).map(mapTransaction);
  }

  async function listAllTransactions() {
    return (await selectBase().where(eq(transactions.userId, dependencies.userId))
      .orderBy(desc(transactions.date), desc(transactions.id))).map(mapTransaction);
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

  function isIdenticalCreation(existing: typeof transactions.$inferSelect, input: TransactionInput, signedAmount: number) {
    return existing.accountId === input.accountId
      && existing.categoryId === input.categoryId
      && existing.date === new Date(input.date).toISOString()
      && existing.amount === signedAmount
      && existing.type === input.type
      && existing.merchant === (input.merchant || null)
      && existing.description === (input.description || null);
  }

  async function createTransaction(raw: TransactionInput, options: TransactionCreationOptions) {
    const input = validateTransactionInput(raw);
    if (!options.clientId.trim()) throw new Error('A transaction request ID is required.');
    const signedAmount = input.type === 'income' ? input.amount : -input.amount;
    const insertedId = database.transaction((tx) => {
      const [account] = tx.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!account) throw new Error('The selected account no longer exists.');
      const [existing] = tx.select().from(transactions).where(eq(transactions.clientId, options.clientId)).limit(1).all();
      if (existing) {
        const validExisting = validatePersistedTransaction(existing);
        if (validExisting.userId !== dependencies.userId || !isIdenticalCreation(validExisting, input, signedAmount)) {
          throw new Error(idempotencyConflictError);
        }
        return existing.id;
      }
      requireCategoryApplicability(tx, input.categoryId, input.type);
      requireSupportedEffectiveDate(input.date, dependencies.now());
      const projectedBalance = checkedBalanceAdd(account.balance, signedAmount);
      if (input.type === 'expense') requireOverdraftConfirmation(account, projectedBalance, options);
      const [created] = tx.insert(transactions).values({ clientId: options.clientId, userId: dependencies.userId,
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
      validatePersistedTransaction(existing);
      const [existingAccount] = tx.select({ id: accounts.id, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, existing.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!existingAccount) throw new Error('Transaction account ownership is inconsistent.');
      if (existing.type === 'transfer') throw new Error(legacyTransferMutationError);
      if (existing.type !== input.type || existing.categoryId !== input.categoryId) {
        requireCategoryApplicability(tx, input.categoryId, input.type);
      }
      requireSupportedEffectiveDate(input.date, dependencies.now(), existing.date);
      const [account] = tx.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!account) throw new Error('The selected account no longer exists.');
      const signedAmount = input.type === 'income' ? input.amount : -input.amount;
      const reversedExistingBalance = checkedBalanceSubtract(existingAccount.balance, existing.amount);
      const projectedBalance = existing.accountId === input.accountId
        ? checkedBalanceAdd(reversedExistingBalance, signedAmount)
        : checkedBalanceAdd(account.balance, signedAmount);
      if (input.type === 'expense') requireOverdraftConfirmation(account, projectedBalance, options);
      tx.update(accounts).set({ balance: reversedExistingBalance }).where(eq(accounts.id, existing.accountId)).run();
      tx.update(transactions).set({ accountId: input.accountId, categoryId: input.categoryId, date: new Date(input.date).toISOString(),
        amount: signedAmount, type: input.type, merchant: input.merchant || null,
        description: input.description || null, updatedAt: dependencies.now().toISOString() })
        .where(eq(transactions.id, id)).run();
      tx.update(accounts).set({ balance: projectedBalance }).where(eq(accounts.id, input.accountId)).run();
      return id;
    });
    return getTransaction(result);
  }

  async function deleteTransaction(id: number) {
    database.transaction((tx) => {
      const [existing] = tx.select().from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, dependencies.userId))).limit(1).all();
      if (!existing) throw new Error('Transaction not found.');
      validatePersistedTransaction(existing);
      const [existingAccount] = tx.select({ id: accounts.id, balance: accounts.balance }).from(accounts)
        .where(and(eq(accounts.id, existing.accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
      if (!existingAccount) throw new Error('Transaction account ownership is inconsistent.');
      if (existing.type === 'transfer') throw new Error(legacyTransferMutationError);
      const reversedExistingBalance = checkedBalanceSubtract(existingAccount.balance, existing.amount);
      tx.delete(transactions).where(eq(transactions.id, id)).run();
      tx.update(accounts).set({ balance: reversedExistingBalance }).where(eq(accounts.id, existingAccount.id)).run();
    });
  }

  return { listTransactions, listAllTransactions, getTransaction, createTransaction, updateTransaction, deleteTransaction };
}
