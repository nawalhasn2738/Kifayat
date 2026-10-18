import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, transactions } from '@/lib/db/schema';
import { validateTransactionInput, type TransactionInput } from '@/lib/validation/transaction';
import type { Transaction } from '@/lib/types';

const selection = {
  id: transactions.id, clientId: transactions.clientId, date: transactions.date,
  amount: transactions.amount, type: transactions.type, merchant: transactions.merchant,
  description: transactions.description, isAnomaly: transactions.isAnomaly,
  categoryId: categories.id, categoryName: categories.name,
  accountId: accounts.id, accountName: accounts.name, accountType: accounts.type,
};
type Selected = Awaited<ReturnType<typeof selectBase>>[number];
function selectBase() {
  return db.select(selection).from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id));
}
function mapTransaction(row: Selected): Transaction {
  return { id: row.id, clientId: row.clientId, date: row.date, amount: row.amount, type: row.type,
    merchant: row.merchant, description: row.description, isAnomaly: row.isAnomaly,
    category: row.categoryId ? { id: row.categoryId, name: row.categoryName! } : null,
    account: { id: row.accountId, name: row.accountName, type: row.accountType } };
}

export async function listTransactions(limit = 100) {
  return (await selectBase().where(eq(transactions.userId, LOCAL_USER_ID)).orderBy(desc(transactions.date)).limit(limit)).map(mapTransaction);
}
export async function getTransaction(id: number) {
  const [row] = await selectBase().where(and(eq(transactions.id, id), eq(transactions.userId, LOCAL_USER_ID))).limit(1);
  return row ? mapTransaction(row) : null;
}
export async function createTransaction(raw: TransactionInput) {
  const input = validateTransactionInput(raw);
  const signedAmount = input.type === 'income' ? input.amount : -input.amount;
  const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const insertedId = await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, LOCAL_USER_ID))).limit(1);
    if (!account) throw new Error('The selected account no longer exists.');
    const [created] = await tx.insert(transactions).values({ clientId, userId: LOCAL_USER_ID,
      accountId: input.accountId, categoryId: input.categoryId, date: new Date(input.date).toISOString(), amount: signedAmount,
      type: input.type, merchant: input.merchant || null, description: input.description || null }).returning({ id: transactions.id });
    await tx.run(sql`UPDATE accounts SET balance = balance + ${signedAmount} WHERE id = ${input.accountId}`);
    return created.id;
  });
  const created = await getTransaction(insertedId);
  if (!created) throw new Error('Transaction was saved but could not be reloaded.');
  return created;
}

export async function updateTransaction(id: number, raw: TransactionInput) {
  const input = validateTransactionInput(raw);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, LOCAL_USER_ID))).limit(1);
    if (!existing) throw new Error('Transaction not found.');
    const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.userId, LOCAL_USER_ID))).limit(1);
    if (!account) throw new Error('The selected account no longer exists.');
    const signedAmount = input.type === 'income' ? input.amount : -input.amount;
    await tx.run(sql`UPDATE accounts SET balance = balance - ${existing.amount} WHERE id = ${existing.accountId}`);
    await tx.update(transactions).set({ accountId: input.accountId, categoryId: input.categoryId, date: new Date(input.date).toISOString(),
      amount: signedAmount, type: input.type, merchant: input.merchant || null,
      description: input.description || null, updatedAt: new Date().toISOString() }).where(eq(transactions.id, id));
    await tx.run(sql`UPDATE accounts SET balance = balance + ${signedAmount} WHERE id = ${input.accountId}`);
    return id;
  });
  return getTransaction(result);
}

export async function deleteTransaction(id: number) {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, LOCAL_USER_ID))).limit(1);
    if (!existing) throw new Error('Transaction not found.');
    await tx.delete(transactions).where(eq(transactions.id, id));
    await tx.run(sql`UPDATE accounts SET balance = balance - ${existing.amount} WHERE id = ${existing.accountId}`);
  });
}
