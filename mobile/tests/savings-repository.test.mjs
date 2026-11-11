import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema.ts';
import { seedLocalProfile } from '../src/lib/db/seed.ts';
import { createSavingsGoalRepository } from '../src/lib/repositories/savings-goals-core.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createTransferRepository } from '../src/lib/repositories/transfers-core.ts';
import { createSummaryService } from '../src/lib/services/finance-core.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core.ts';
import { createSavingsPlanningService, assessRecordedInstallment } from '../src/lib/services/savings-planning-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';
const now = () => new Date('2026-11-11T12:00:00.000Z');
async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema }); await seedLocalProfile(database);
    const catalog = createCatalogRepository(database), goals = createSavingsGoalRepository(database);
    const txs = createTransactionRepository(database, { userId: 1, now });
    const history = createHistoryStartStateService(database, { userId: 1, now });
    const forecast = createForecastReadinessService({ getFinancialHistoryState: history.getFinancialHistoryState, listAllTransactions: txs.listAllTransactions, now });
    const dependencies = { listGoals: goals.listGoals, getHistory: history.getFinancialHistoryState, getForecast: forecast,
      getSummary: createSummaryService({ listAccounts: catalog.listAccounts, listAllTransactions: txs.listAllTransactions, now }),
      listAllTransactions: txs.listAllTransactions, listCategories: catalog.listCategories, now };
    await run({ sqlite, database, goals, catalog, dependencies, service: createSavingsPlanningService(dependencies).getSavingsPlanning });
  } finally { sqlite.close(); }
}
async function records(database) {
  await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.type, 'checking'));
  const [category] = await database.select().from(schema.categories).where(eq(schema.categories.name, 'groceries'));
  await database.update(schema.accounts).set({ balance: 300_000 }).where(eq(schema.accounts.id, account.id));
  const rows = [
    ...['08', '09', '10'].flatMap(month => [
      { date: `2026-${month}-02T12:00:00.000Z`, type: 'income', amount: 100_000 },
      { date: `2026-${month}-02T12:00:00.000Z`, type: 'expense', amount: -20_000 },
    ]),
    { date: '2026-11-02T12:00:00.000Z', type: 'income', amount: 40_000 },
    { date: '2026-11-02T12:00:00.000Z', type: 'expense', amount: -10_000 },
    { date: '2026-07-31T18:59:59.999Z', type: 'income', amount: 99_999 },
    { date: '2026-11-12T12:00:00.000Z', type: 'income', amount: 99_999 },
  ];
  for (const [index, row] of rows.entries()) await database.insert(schema.transactions).values({ ...row, clientId: `goal-${index}`, userId: 1, accountId: account.id, categoryId: category.id });
}

test('savings goals repository: creates and updates existing storage, preserves stored amount, profile, accounts and transactions', async () => {
  await fixture(async ({ database, goals }) => {
    await records(database);
    const accounts = await database.select().from(schema.accounts), txs = await database.select().from(schema.transactions), profiles = await database.select().from(schema.userProfiles);
    const goal = await goals.createGoal({ name: 'Laptop', targetAmount: 100_000, targetDate: '2027-01-31T19:00:00.000Z' });
    await database.update(schema.savingsGoals).set({ currentAmount: 1_000 }).where(eq(schema.savingsGoals.id, goal.id));
    await goals.updateGoalTarget(goal.id, 150_000);
    const updated = (await goals.listGoals()).find(row => row.id === goal.id);
    assert.equal(updated.targetAmount, 150_000); assert.equal(updated.currentAmount, 1_000);
    assert.equal(updated.name, 'Laptop'); assert.equal(updated.targetDate, goal.targetDate);
    assert.deepEqual(await database.select().from(schema.accounts), accounts);
    assert.deepEqual(await database.select().from(schema.transactions), txs);
    assert.deepEqual(await database.select().from(schema.userProfiles), profiles);
  });
});

test('savings goals repository: zero, malformed and excessive targets fail without writes; ownership is fixed', async () => {
  await fixture(async ({ database, goals, sqlite }) => {
    const [original] = await goals.listGoals();
    for (const amount of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, '100']) {
      await assert.rejects(goals.updateGoalTarget(original.id, amount));
      await assert.rejects(goals.createGoal({ name: 'Invalid', targetAmount: amount, targetDate: original.targetDate }));
    }
    await assert.rejects(goals.createGoal({ name: '', targetAmount: 100, targetDate: original.targetDate }));
    await assert.rejects(goals.createGoal({ name: 'Bad date', targetAmount: 100, targetDate: '2026-02-30T00:00:00.000Z' }));
    await database.insert(schema.users).values({ id: 2, email: 'goal-other@example.test', name: 'Other' });
    const other = createSavingsGoalRepository(database, { userId: 2 });
    const foreign = await other.createGoal({ name: 'Other goal', targetAmount: 500, targetDate: original.targetDate });
    await assert.rejects(goals.updateGoalTarget(foreign.id, 100), /unavailable/);
    const created = await goals.createGoal({ userId: 2, currentAmount: 999, name: 'Owned', targetAmount: 100, targetDate: original.targetDate });
    assert.equal(created.userId, 1); assert.equal(created.currentAmount, 0);
    assert.equal((await other.listGoals())[0].targetAmount, 500);
    sqlite.exec("CREATE TRIGGER goal_fail BEFORE UPDATE ON savings_goals BEGIN SELECT RAISE(ABORT, 'fixture fail'); END");
    await assert.rejects(goals.updateGoalTarget(original.id, 999));
    assert.equal((await goals.listGoals())[0].targetAmount, original.targetAmount);
  });
});

test('savings planning: progress and recommendations are grounded in records with current and future month exclusions', async () => {
  await fixture(async ({ database, service, catalog }) => {
    await records(database);
    const data = await service();
    assert.equal(data.progressStatus, 'ready');
    assert.equal(data.goals[0].progress.current, 270_000); assert.equal(data.goals[0].progress.remaining, 0); assert.equal(data.goals[0].progress.percent, 100);
    assert.deepEqual(data.analysis.qualifyingMonths, ['2026-08', '2026-09', '2026-10']);
    assert.equal(data.analysis.income, 100_000); assert.equal(data.analysis.expectedExpenses, 20_000);
    assert.equal(data.analysis.recommendation.recommendedMonthlyTransfer, 20_000);
    assert.deepEqual(data.analysis.patterns, [{ name: 'groceries', total: 60_000 }]);
    assert.equal(data.analysis.essentialMonthlySpend, 20_000);
    assert.equal(assessRecordedInstallment(data, { price: 72_000, months: 3, apr: 0 }).safe, true);
    await catalog.saveProfileSettings({ monthlyIncome: 2_000_000, emergencyFundTarget: 1_000_000 });
    assert.deepEqual(await service(), data);
  });
});

test('savings planning: real inter-account transfers and legacy transfers never increase recorded net savings or recommendations', async () => {
  await fixture(async ({ database, service }) => {
    await records(database); const before = await service();
    const accounts = await database.select().from(schema.accounts);
    const source = accounts.find(row => row.type === 'checking'), destination = accounts.find(row => row.type === 'savings');
    const transfers = createTransferRepository(database, { userId: 1, now });
    await transfers.createTransfer({ sourceAccountId: source.id, destinationAccountId: destination.id, amount: 10_000, date: '2026-11-10T12:00:00.000Z', description: null }, 'goal-transfer');
    await database.insert(schema.transactions).values({ clientId: 'goal-legacy-transfer', userId: 1, accountId: source.id, type: 'transfer', amount: 99_999, date: '2026-09-02T12:00:00.000Z' });
    assert.deepEqual(await service(), before);
    const after = await database.select().from(schema.accounts);
    assert.equal(after.reduce((sum, row) => sum + row.balance, 0), accounts.reduce((sum, row) => sum + row.balance, 0));
  });
});

test('savings planning: missing and insufficient history, missing accounts and unavailable summaries never become confirmed zero', async () => {
  await fixture(async ({ database, service, dependencies }) => {
    let data = await service(); assert.equal(data.progressStatus, 'unavailable'); assert.equal(data.goals[0].progress.current, null); assert.equal(data.analysis.status, 'unavailable');
    await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-09-30T19:00:00.000Z' });
    data = await service(); assert.equal(data.progressStatus, 'ready'); assert.equal(data.analysis.status, 'unavailable');
    assert.match(data.analysis.guidance, /three preceding complete/);
    const failed = await createSavingsPlanningService({ ...dependencies, getSummary: async () => { throw new Error('private'); } }).getSavingsPlanning();
    assert.equal(failed.goals[0].progress.current, null); assert.equal(failed.analysis.status, 'unavailable');
    const noAccounts = await createSavingsPlanningService({ ...dependencies, getSummary: async asOf => ({ ...await dependencies.getSummary(asOf), balances: [] }) }).getSavingsPlanning();
    assert.equal(noAccounts.goals[0].progress.current, null);
    await database.delete(schema.userProfiles);
    data = await service(); assert.equal(data.goals[0].progress.current, null);
  });
});

test('savings planning: confirmed empty eligible months are zero while uncategorized expenses block installment conclusions', async () => {
  await fixture(async ({ database, service }) => {
    await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
    const data = await service(); assert.equal(data.goals[0].progress.current, 0); assert.equal(data.analysis.status, 'ready');
    assert.equal(data.analysis.recommendation.recommendedMonthlyTransfer, 0);
    const [account] = await database.select().from(schema.accounts);
    await database.insert(schema.transactions).values({ clientId: 'goal-unknown-category', userId: 1, accountId: account.id, amount: -100, type: 'expense', date: '2026-09-02T12:00:00.000Z' });
    const unknown = await service(); assert.equal(unknown.analysis.installmentReady, false);
    assert.throws(() => assessRecordedInstallment(unknown, { price: 100, months: 1, apr: 0 }), /classified/);
    assert.equal(unknown.goals[0].progress.netSavings, -100);
    await database.delete(schema.savingsGoals);
    assert.deepEqual((await service()).goals, []);
  });
});

test('savings goals persistence: targets survive disposable SQLite close/reopen and repeated seeding', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kifayat-goals-test-'));
  const path = join(directory, 'goals-fixture.sqlite'); let sqlite;
  try {
    sqlite = new Database(path); await migrateWithExpoPath(sqlite); let db = drizzle(sqlite, { schema }); await seedLocalProfile(db);
    const goals = createSavingsGoalRepository(db); const [seeded] = await goals.listGoals();
    await goals.updateGoalTarget(seeded.id, 500_000);
    await goals.createGoal({ name: 'Study', targetAmount: 80_000, targetDate: '2027-01-31T19:00:00.000Z' });
    const before = await goals.listGoals(); sqlite.close(); sqlite = new Database(path); db = drizzle(sqlite, { schema });
    await seedLocalProfile(db); assert.deepEqual(await createSavingsGoalRepository(db).listGoals(), before);
  } finally { if (sqlite?.open) sqlite.close(); unlinkSync(path); rmdirSync(directory); }
});
