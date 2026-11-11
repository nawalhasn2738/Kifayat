import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema.ts';
import { seedLocalProfile } from '../src/lib/db/seed.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createTransferRepository } from '../src/lib/repositories/transfers-core.ts';
import { createSavingsGoalRepository } from '../src/lib/repositories/savings-goals-core.ts';
import { createSummaryService, calculateRisk } from '../src/lib/services/finance-core.ts';
import { createAffordabilityService } from '../src/lib/services/affordability-core.ts';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { createSavingsPlanningService } from '../src/lib/services/savings-planning-core.ts';
import { createActivityService } from '../src/lib/services/activity-core.ts';
import { createDashboardService } from '../src/lib/services/dashboard-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';
const now = () => new Date('2026-11-11T12:00:00.000Z');
async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema }); await seedLocalProfile(database);
    const catalog = createCatalogRepository(database), transactions = createTransactionRepository(database, { userId: 1, now }), transfers = createTransferRepository(database, { userId: 1, now });
    const goals = createSavingsGoalRepository(database);
    const history = createHistoryStartStateService(database, { userId: 1, now });
    const getSummary = createSummaryService({ listAccounts: catalog.listAccounts, listAllTransactions: transactions.listAllTransactions, now });
    const getForecast = createForecastReadinessService({ getFinancialHistoryState: history.getFinancialHistoryState, listAllTransactions: transactions.listAllTransactions, now });
    const getRisk = async asOf => calculateRisk(await getSummary(asOf), await catalog.getProfile(), await catalog.listCategories(), await transactions.listAllTransactions(), asOf);
    const { getSavingsPlanning } = createSavingsPlanningService({ listGoals: goals.listGoals, getHistory: history.getFinancialHistoryState, getSummary, getForecast,
      listAllTransactions: transactions.listAllTransactions, listCategories: catalog.listCategories, now });
    const queryLog = [];
    const activity = createActivityService({ listTransactionActivity: query => { queryLog.push(query); return transactions.listTransactionActivity(query); }, listTransferActivity: transfers.listTransferActivity });
    const dependencies = { getSummary, getForecast, getRisk, getSavingsPlanning, getHistory: history.getFinancialHistoryState, getProfile: catalog.getProfile, getActivity: activity, listActiveAccounts: catalog.listActiveAccounts, now };
    const dashboard = createDashboardService(dependencies);
    await run({ database, catalog, transactions, transfers, goals, dashboard, dependencies, queryLog });
  } finally { sqlite.close(); }
}
async function records(database) {
  await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.type, 'checking'));
  const [category] = await database.select().from(schema.categories).where(eq(schema.categories.name, 'groceries'));
  const rows = [...['08', '09', '10'].flatMap(month => [{ date: `2026-${month}-02T12:00:00.000Z`, type: 'income', amount: 100_000 }, { date: `2026-${month}-02T12:00:00.000Z`, type: 'expense', amount: -20_000 }]),
    { date: '2026-11-02T12:00:00.000Z', type: 'income', amount: 50_000 }, { date: '2026-11-02T12:00:00.000Z', type: 'expense', amount: -10_000 },
    { date: '2026-12-02T12:00:00.000Z', type: 'income', amount: 999_999 }];
  for (const [index, row] of rows.entries()) await database.insert(schema.transactions).values({ ...row, clientId: `dashboard-${index}`, userId: 1, accountId: account.id, categoryId: category.id });
  await database.update(schema.accounts).set({ balance: 300_000 }).where(eq(schema.accounts.id, account.id));
  return account;
}

test('dashboard aggregation: MTD, savings, rate, forecast, trend, reserve and risk exactly reuse existing services', async () => {
  await fixture(async ({ database, dashboard, dependencies, catalog }) => {
    await records(database); const data = await dashboard(); const summary = await dependencies.getSummary(now());
    assert.deepEqual(data.summary.value, summary);
    assert.equal(summary.income.thisMonth, 50_000); assert.equal(summary.spend.thisMonthMTD, 10_000); assert.equal(summary.savings.thisMonth, 40_000);
    assert.equal(data.rate, summary.savings.rate); assert.equal(data.projection, summary.spend.thisMonthProjected);
    assert.deepEqual(data.forecast.value, await dependencies.getForecast(now()));
    assert.equal(data.forecast.value.forecast.total.blend, 20_000);
    assert.deepEqual(data.risk.value, await dependencies.getRisk(now()));
    assert.equal(Math.round(data.risk.value.factors.reduce((sum, factor) => sum + factor.weight, 0) * 100), 100);
    const assess = createAffordabilityService({ getSummary: () => dependencies.getSummary(now()), getProfile: catalog.getProfile, getForecast: () => dependencies.getForecast(now()), listActiveAccounts: catalog.listActiveAccounts });
    assert.equal(data.reserve.value.buffer, (await assess({ itemName: 'Reference', price: 10_000, monthsAhead: 1 })).result.buffer);
    assert.deepEqual(data.reserve.value, { buffer: 240_000, eligibleBalance: 300_000, difference: 60_000, months: ['2026-08', '2026-09', '2026-10'] });
    assert.equal(data.trend.find(row => row.month === '2026-07').income, null);
    assert.equal(data.trend.find(row => row.month === '2026-10').expense, 20_000);
    assert.ok(!data.trend.some(row => row.month === '2026-11'));
    assert.equal(data.savings.value.goals[0].progress.current, 280_000); assert.equal(data.savings.value.goals[0].progress.percent, 100);
  });
});

test('dashboard recent activity: bounded query, future exclusion and native transfer distinction', async () => {
  await fixture(async ({ database, dashboard, queryLog, transfers, dependencies }) => {
    const account = await records(database); const accounts = await database.select().from(schema.accounts);
    await transfers.createTransfer({ sourceAccountId: account.id, destinationAccountId: accounts.find(row => row.type === 'savings').id, amount: 10_000, date: '2026-11-10T12:00:00.000Z', description: 'Reserve move' }, 'dashboard-transfer');
    const data = await dashboard();
    assert.equal(data.recent.value.items.length, 5); assert.equal(data.recent.value.items[0].kind, 'transfer');
    assert.equal(queryLog[0].pageSize, 5);
    assert.ok(data.recent.value.items.every(row => row.date <= now().toISOString()));
    assert.equal(data.summary.value.income.thisMonth, 50_000); assert.equal(data.summary.value.savings.thisMonth, 40_000);
    assert.deepEqual(data.savings.value, await dependencies.getSavingsPlanning(now()));
    const before = await database.select().from(schema.accounts); await dashboard(); assert.deepEqual(await database.select().from(schema.accounts), before);
  });
});

test('dashboard readiness: missing profile and incomplete history do not become low risk, forecast or reserve zero', async () => {
  await fixture(async ({ database, dashboard }) => {
    let data = await dashboard(); assert.equal(data.risk.status, 'unavailable'); assert.equal(data.reserve.status, 'unavailable'); assert.equal(data.projection, null);
    assert.ok(data.trend.every(row => row.income === null)); assert.equal(data.savings.value.goals[0].progress.current, null);
    await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-11-04T19:00:00.000Z' });
    data = await dashboard(); assert.match(data.coverage, /partway/); assert.equal(data.forecast.value.status, 'insufficient_history'); assert.equal(data.risk.status, 'unavailable');
    await database.delete(schema.userProfiles);
    data = await dashboard(); assert.equal(data.profile.status, 'unavailable'); assert.equal(data.risk.status, 'unavailable'); assert.equal(data.reserve.status, 'unavailable');
    assert.equal(data.summary.status, 'ready'); assert.equal(data.recent.status, 'ready');
  });
});

test('dashboard empty/error states: confirmed empty months differ from missing data; failures stay section scoped', async () => {
  await fixture(async ({ database, dashboard, dependencies }) => {
    await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
    let data = await dashboard(); assert.equal(data.summary.value.savings.thisMonth, 0); assert.equal(data.rate, null); assert.equal(data.projection, 0);
    assert.equal(data.forecast.value.forecast.total.blend, 0); assert.equal(data.savings.value.goals[0].progress.current, 0); assert.deepEqual(data.recent.value.items, []);
    assert.equal(data.trend.find(row => row.month === '2026-09').expense, 0);
    data = await createDashboardService({ ...dependencies, getSummary: async () => { throw new Error('private summary'); }, getActivity: async () => { throw new Error('private activity'); } })();
    assert.equal(data.summary.status, 'unavailable'); assert.equal(data.recent.status, 'unavailable'); assert.equal(data.risk.status, 'unavailable'); assert.equal(data.savings.status, 'ready');
    assert.doesNotMatch(JSON.stringify(data), /private/);
    await database.delete(schema.accounts); data = await dashboard(); assert.equal(data.hasAccounts, false); assert.equal(data.risk.status, 'unavailable'); assert.equal(data.reserve.status, 'unavailable');
  });
});

test('dashboard refresh reads changed transactions, transfers, financial profile and goal targets', async () => {
  await fixture(async ({ database, dashboard, catalog, transactions, goals, transfers }) => {
    const account = await records(database); const before = await dashboard();
    const tx = await transactions.createTransaction({ accountId: account.id, categoryId: null, type: 'income', amount: 1_000, date: '2026-11-10T12:00:00.000Z', merchant: null, description: 'New income' }, { clientId: 'dashboard-new-income' });
    assert.equal((await dashboard()).summary.value.income.thisMonth, 51_000);
    await transactions.deleteTransaction(tx.id); assert.equal((await dashboard()).summary.value.income.thisMonth, 50_000);
    await catalog.saveProfileSettings({ monthlyIncome: 10_000, emergencyFundTarget: 70_000 });
    let after = await dashboard(); assert.ok(after.risk.value.score > before.risk.value.score); assert.equal(after.reserve.value.buffer, 70_000);
    const [goal] = await goals.listGoals(); await goals.updateGoalTarget(goal.id, 500_000); after = await dashboard(); assert.equal(after.savings.value.goals[0].progress.remaining, 220_000);
    const savingsAccount = (await catalog.listActiveAccounts()).find(row => row.type === 'savings');
    await transfers.createTransfer({ sourceAccountId: account.id, destinationAccountId: savingsAccount.id, amount: 100, date: '2026-11-11T11:00:00.000Z', description: 'Move' }, 'dashboard-refresh-transfer');
    after = await dashboard(); assert.equal(after.recent.value.items[0].kind, 'transfer'); assert.equal(after.summary.value.savings.thisMonth, 40_000);
  });
});
