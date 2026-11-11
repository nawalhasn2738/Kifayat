import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createTransferRepository } from '../src/lib/repositories/transfers-core.ts';
import { createActivityService, compareActivity } from '../src/lib/services/activity-core.ts';
import { activityDateRange } from '../src/lib/validation/activity.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';
const now = () => new Date('2028-04-01T12:00:00.000Z');
async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([{ id: 1, email: 'activity-local@example.test', name: 'Local' }, { id: 2, email: 'activity-other@example.test', name: 'Other' }]);
    await database.insert(schema.accounts).values([
      { id: 1, userId: 1, name: 'Bank', type: 'checking', balance: 100_000, openingBalance: 100_000 },
      { id: 2, userId: 1, name: 'Savings', type: 'savings', balance: 0, openingBalance: 0, archivedAt: '2027-01-01T00:00:00.000Z' },
      { id: 3, userId: 2, name: 'Other private bank', type: 'checking', balance: 100_000 },
    ]);
    await database.insert(schema.categories).values([{ id: 1, name: 'groceries', isEssential: true }, { id: 2, name: 'salary' }]);
    await database.insert(schema.categoryApplicability).values([{ categoryId: 1, transactionType: 'expense' }, { categoryId: 2, transactionType: 'income' }]);
    const transactions = createTransactionRepository(database, { userId: 1, now });
    const transfers = createTransferRepository(database, { userId: 1, now });
    const activity = createActivityService({ listTransactionActivity: transactions.listTransactionActivity, listTransferActivity: transfers.listTransferActivity });
    const addTransaction = async (overrides = {}) => (await database.insert(schema.transactions).values({ clientId: `activity-${Math.random()}`, userId: 1, accountId: 1,
      categoryId: 1, type: 'expense', amount: -100, date: '2028-02-29T12:00:00.000Z', merchant: 'Market', description: 'Weekly groceries', ...overrides }).returning())[0];
    const addTransfer = async (overrides = {}) => (await database.insert(schema.transfers).values({ clientId: `transfer-${Math.random()}`, userId: 1, sourceAccountId: 1,
      destinationAccountId: 2, date: '2028-02-29T12:00:00.000Z', amount: 50, description: 'Move reserve', ...overrides }).returning())[0];
    await run({ sqlite, database, transactions, transfers, activity, addTransaction, addTransfer });
  } finally { sqlite.close(); }
}
async function allPages(activity, filters = { type: 'all' }, pageSize = 2) {
  let cursor = null; const items = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const page = await activity({ filters, cursor, pageSize });
    assert.ok(page.items.length <= pageSize);
    items.push(...page.items); cursor = page.nextCursor;
    if (!cursor) return items;
  }
  throw new Error('Pagination did not terminate.');
}

test('activity repository: combined type/category/account/date/search filters run in SQLite', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    const match = await addTransaction();
    await addTransaction({ accountId: 2 }); await addTransaction({ categoryId: null });
    await addTransaction({ merchant: 'Different', description: 'Different' });
    await addTransaction({ date: '2028-02-28T12:00:00.000Z' });
    await addTransaction({ type: 'income', amount: 100, categoryId: 2 }); await addTransfer();
    const filters = { type: 'expense', categoryId: 1, accountId: 1, search: 'WEEKLY', ...activityDateRange('range', '', '2028-02-29', '2028-03-01') };
    const page = await activity({ filters });
    assert.deepEqual(page.items.map(row => [row.kind, row.id]), [['transaction', match.id]]);
    assert.equal((await activity({ filters: { type: 'all', categoryId: null } })).items.length, 1);
    assert.equal((await activity({ filters: { type: 'all', categoryId: 9999 } })).items.length, 0);
    assert.equal((await activity({ filters: { type: 'all', accountId: 9999 } })).items.length, 0);
  });
});

test('activity repository: income/expense/legacy/native transfers remain separate and account matches either endpoint', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    await addTransaction(); await addTransaction({ type: 'income', amount: 100, categoryId: 2 });
    const legacy = await addTransaction({ type: 'transfer', amount: -50, categoryId: null }); const transfer = await addTransfer();
    const income = await activity({ filters: { type: 'income' } }); assert.ok(income.items.every(row => row.kind === 'transaction' && row.type === 'income')); assert.equal(income.items.length, 1);
    const expenses = await activity({ filters: { type: 'expense' } }); assert.equal(expenses.items.length, 1); assert.equal(expenses.items[0].type, 'expense');
    const transfers = await activity({ filters: { type: 'transfer' } });
    assert.deepEqual(transfers.items.map(row => [row.kind, row.id]), [['transfer', transfer.id], ['transaction', legacy.id]]);
    for (const accountId of [1, 2]) assert.ok((await activity({ filters: { type: 'transfer', accountId } })).items.some(row => row.kind === 'transfer'));
    assert.equal((await activity({ filters: { type: 'transfer', categoryId: 1 } })).items.length, 0);
    assert.deepEqual((await activity({ filters: { type: 'transfer', categoryId: null } })).items.map(row => row.id), [legacy.id]);
  });
});

test('activity repository: search is literal, parameterized and local across merchants/descriptions including transfers', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    const literal = await addTransaction({ merchant: '100%_\\ store', description: "Bob's weekly shop" });
    await addTransaction({ merchant: '100percent', description: 'Other' });
    await addTransfer({ description: '100%_\\ move' });
    for (const search of ['%', '_', '\\']) assert.equal((await activity({ filters: { type: 'all', search } })).items.length, 2);
    assert.deepEqual((await activity({ filters: { type: 'all', search: "Bob's" } })).items.map(row => row.id), [literal.id]);
    assert.equal((await activity({ filters: { type: 'all', search: "' OR 1=1 --" } })).items.length, 0);
  });
});

test('activity repository: Karachi half-open leap-day, month and year boundaries include start and exclude end', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    for (const [mode, month, from, before] of [['month', '2028-02', '', ''], ['month', '2027-12', '', ''], ['month', '2028-01', '', ''], ['range', '', '2028-02-29', '2028-03-01']]) {
      const range = activityDateRange(mode, month, from, before);
      const atStart = await addTransaction({ date: range.start });
      await addTransaction({ date: new Date(Date.parse(range.start) - 1).toISOString() });
      const atEndMinusOne = await addTransfer({ date: new Date(Date.parse(range.endExclusive) - 1).toISOString() });
      await addTransfer({ date: range.endExclusive });
      const result = await activity({ filters: { type: 'all', ...range } });
      assert.ok(result.items.some(row => row.kind === 'transaction' && row.id === atStart.id));
      assert.ok(result.items.some(row => row.kind === 'transfer' && row.id === atEndMinusOne.id));
      assert.ok(result.items.every(row => row.date >= range.start && row.date < range.endExclusive));
    }
  });
});

test('activity repository: stable mixed ordering, keyset pagination and filters have no duplicate or omitted events', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    for (let index = 0; index < 11; index++) {
      await addTransaction({ description: 'Keep', accountId: index % 2 ? 1 : 2 });
      await addTransfer({ description: 'Keep' });
    }
    await addTransaction({ date: '2028-02-28T12:00:00.000Z', description: 'Keep' });
    await addTransfer({ date: '2028-03-01T12:00:00.000Z', description: 'Keep' });
    for (const filters of [{ type: 'all' }, { type: 'all', search: 'Keep', accountId: 1 }, { type: 'expense', categoryId: 1 }, { type: 'transfer' }]) {
      const reference = (await activity({ filters, pageSize: 100 })).items;
      const paged = await allPages(activity, filters, 3);
      assert.deepEqual(paged, reference);
      assert.deepEqual(paged, [...paged].sort(compareActivity));
      assert.equal(new Set(paged.map(row => `${row.kind}:${row.id}`)).size, paged.length);
    }
    const first = await activity({ pageSize: 2 });
    await assert.rejects(activity({ filters: { type: 'income' }, cursor: first.nextCursor }), /cursor/);
  });
});

test('activity repository: full history beyond 5000 is reachable with bounded query results and existing date indexes', async () => {
  await fixture(async ({ sqlite, database, activity }) => {
    const insert = sqlite.prepare("INSERT INTO transactions (client_id,user_id,account_id,category_id,date,amount,type) VALUES (?,1,1,1,?,-1,'expense')");
    sqlite.transaction(() => { for (let index = 0; index < 5_107; index++) insert.run(`large-${index}`, new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString()); })();
    const paged = await allPages(activity, { type: 'expense' }, 100);
    assert.equal(paged.length, 5_107); assert.equal(new Set(paged.map(row => row.id)).size, 5_107);
    assert.equal(paged.at(-1).clientId, 'large-0');
    const plan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM transactions WHERE user_id = ? AND date < ? ORDER BY date DESC, id DESC LIMIT 51').all(1, '2030-01-01T00:00:00.000Z');
    assert.ok(plan.some(row => row.detail.includes('transactions_user_date_idx')));
    assert.equal((await database.select().from(schema.transactions)).length, 5_107);
  });
});

test('activity repository: ownership restrictions exclude other users and inconsistent account relationships', async () => {
  await fixture(async ({ activity, addTransaction, addTransfer }) => {
    const own = await addTransaction();
    await addTransaction({ userId: 2, accountId: 3, merchant: 'Other secret' });
    await addTransaction({ userId: 1, accountId: 3, merchant: 'Broken owner secret' });
    await addTransfer({ userId: 1, destinationAccountId: 3 });
    await addTransfer({ userId: 2, sourceAccountId: 3, destinationAccountId: 1 });
    assert.deepEqual((await activity()).items.map(row => [row.kind, row.id]), [['transaction', own.id]]);
    assert.equal((await activity({ filters: { type: 'all', accountId: 3 } })).items.length, 0);
  });
});

test('activity repository: fresh pages reflect create/edit/delete without altering unrelated records', async () => {
  await fixture(async ({ database, activity, transactions, transfers }) => {
    const input = { accountId: 1, categoryId: 2, type: 'income', amount: 1_000, date: '2028-02-29T12:00:00.000Z', merchant: 'Salary', description: 'Initial' };
    assert.deepEqual((await activity()).items, []);
    const created = await transactions.createTransaction(input, { clientId: 'crud-income' });
    assert.equal((await activity({ filters: { type: 'income', search: 'Initial' } })).items[0].id, created.id);
    await transactions.updateTransaction(created.id, { ...input, description: 'Updated' });
    assert.equal((await activity({ filters: { type: 'income', search: 'Initial' } })).items.length, 0);
    assert.equal((await activity({ filters: { type: 'income', search: 'Updated' } })).items.length, 1);
    await transactions.deleteTransaction(created.id); assert.deepEqual((await activity()).items, []);
    await database.update(schema.accounts).set({ archivedAt: null }).where(eq(schema.accounts.id, 2));
    const transferInput = { sourceAccountId: 1, destinationAccountId: 2, amount: 10, date: input.date, description: 'Move' };
    const transfer = await transfers.createTransfer(transferInput, 'crud-transfer');
    assert.equal((await activity({ filters: { type: 'transfer', search: 'Move' } })).items[0].id, transfer.id);
    await transfers.updateTransfer(transfer.id, { ...transferInput, description: 'Revised' });
    assert.equal((await activity({ filters: { type: 'transfer', search: 'Move' } })).items.length, 0);
    await transfers.deleteTransfer(transfer.id); assert.deepEqual((await activity()).items, []);
    const accounts = await database.select().from(schema.accounts);
    await activity(); assert.deepEqual(await database.select().from(schema.accounts), accounts);
  });
});

test('activity repository: empty results and failed database reads are explicit', async () => {
  await fixture(async ({ activity, sqlite }) => {
    assert.deepEqual((await activity()).items, []);
    assert.equal((await activity()).nextCursor, null);
    sqlite.exec('DROP TABLE transactions');
    await assert.rejects(activity());
  });
});
