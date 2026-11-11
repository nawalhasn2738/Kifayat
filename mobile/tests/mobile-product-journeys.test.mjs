import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { seedLocalProfile } from '../src/lib/db/seed.ts';
import { createAccountRepository } from '../src/lib/repositories/accounts-core.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createTransferRepository } from '../src/lib/repositories/transfers-core.ts';
import { createOpeningBalanceRepository } from '../src/lib/repositories/opening-balances-core.ts';
import { createSavingsGoalRepository } from '../src/lib/repositories/savings-goals-core.ts';
import { createChatRepository } from '../src/lib/repositories/chat-core.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { createHistoryStartCommandService } from '../src/lib/services/history-start-commands-core.ts';
import { createSummaryService, calculateRisk } from '../src/lib/services/finance-core.ts';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core.ts';
import { createAffordabilityService } from '../src/lib/services/affordability-core.ts';
import { createSavingsPlanningService, assessRecordedInstallment } from '../src/lib/services/savings-planning-core.ts';
import { createActivityService } from '../src/lib/services/activity-core.ts';
import { createDashboardService } from '../src/lib/services/dashboard-core.ts';
import { createChatContextProvider } from '../src/lib/services/chat-context-core.ts';
import { createChatClient } from '../src/lib/services/chat-client-core.ts';
import { createChatSession } from '../src/lib/services/chat-session-core.ts';
import { createMobileChatHandler } from '../../src/lib/chat/mobile-handler.ts';
import { activityDateRange } from '../src/lib/validation/activity.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';
const now = () => new Date('2026-11-11T12:00:00.000Z');
function product(sqlite) {
  const database = drizzle(sqlite, { schema });
  const catalog = createCatalogRepository(database), transactions = createTransactionRepository(database, { userId: 1, now });
  const accounts = createAccountRepository(database, { userId: 1, now }), transfers = createTransferRepository(database, { userId: 1, now });
  const openings = createOpeningBalanceRepository(database, { userId: 1, now }), goals = createSavingsGoalRepository(database);
  const history = createHistoryStartStateService(database, { userId: 1, now }), commands = createHistoryStartCommandService(database, { userId: 1, now });
  const getSummary = createSummaryService({ listAccounts: catalog.listAccounts, listAllTransactions: transactions.listAllTransactions, now });
  const getForecast = createForecastReadinessService({ getFinancialHistoryState: history.getFinancialHistoryState, listAllTransactions: transactions.listAllTransactions, now });
  const assess = createAffordabilityService({ getSummary, getForecast, getProfile: catalog.getProfile, listActiveAccounts: catalog.listActiveAccounts });
  const { getSavingsPlanning } = createSavingsPlanningService({ listGoals: goals.listGoals, getSummary, getForecast, getHistory: history.getFinancialHistoryState, listAllTransactions: transactions.listAllTransactions, listCategories: catalog.listCategories, now });
  const getActivity = createActivityService({ listTransactionActivity: transactions.listTransactionActivity, listTransferActivity: transfers.listTransferActivity });
  const getRisk = async asOf => calculateRisk(await getSummary(asOf), await catalog.getProfile(), await catalog.listCategories(), await transactions.listAllTransactions(), asOf);
  const getDashboard = createDashboardService({ getSummary, getForecast, getRisk, getSavingsPlanning, getActivity, getHistory: history.getFinancialHistoryState, getProfile: catalog.getProfile, listActiveAccounts: catalog.listActiveAccounts, now });
  const getContext = createChatContextProvider({ listAccounts: catalog.listAccounts, listAllTransactions: transactions.listAllTransactions, getForecast, getHistory: history.getFinancialHistoryState, now,
    getAffordability: (input, _asOf, snapshot) => createAffordabilityService({ getSummary: async () => snapshot.summary, getForecast: async () => snapshot.forecast, getProfile: catalog.getProfile, listActiveAccounts: catalog.listActiveAccounts })(input) });
  return { database, catalog, accounts, transactions, transfers, openings, goals, history, commands, getSummary, getForecast, assess, getSavingsPlanning, getActivity, getDashboard, getContext, chatStore: createChatRepository(database) };
}

test('integrated mobile product: journeys A–E share one ledger and survive database reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kifayat-product-test-'));
  const path = join(directory, 'product-fixture.sqlite');
  let sqlite, app, bank, savingsAccount, groceries, salary, expense, laptop, conversationId;
  try {
    sqlite = new Database(path); sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite); app = product(sqlite);
    await t.test('A: migrate, seed, create account, confirm opening balance and history', async () => {
      await seedLocalProfile(app.database); await seedLocalProfile(app.database);
      assert.equal((await app.catalog.listAccounts()).length, 3);
      assert.equal((await app.history.getFinancialHistoryState()).status, 'unconfirmed');
      const travel = await app.accounts.createAccount({ name: 'Private Travel', type: 'savings', openingBalance: 0 });
      assert.equal(travel.openingBalance, 0);
      bank = (await app.catalog.listAccounts()).find(row => row.type === 'checking');
      savingsAccount = (await app.catalog.listAccounts()).find(row => row.name === 'Savings');
      assert.equal((await app.openings.getState(bank.id)).openingBalance, null);
      await app.openings.confirm(bank.id, 100_000);
      assert.equal((await app.getSummary()).totalBalance, 100_000);
      assert.equal((await app.commands.confirmHistoryStart({ calendarDate: '2026-08-01' })).status, 'confirmed');
      assert.equal((await app.getForecast()).status, 'ready');
      groceries = (await app.catalog.listCategories()).find(row => row.name === 'groceries');
      salary = (await app.catalog.listCategories()).find(row => row.name === 'salary');
    });
    await t.test('B: income, expenses, edits, deletion, idempotent retries and real transfers reconcile balances', async () => {
      let balance = 100_000;
      for (const month of ['08', '09', '10']) {
        await app.transactions.createTransaction({ accountId: bank.id, categoryId: salary.id, type: 'income', amount: 100_000, date: `2026-${month}-02T12:00:00.000Z`, merchant: 'Private employer', description: 'Private income note' }, { clientId: `journey-income-${month}` }); balance += 100_000;
        assert.equal((await app.getSummary()).totalBalance, balance);
        await app.transactions.createTransaction({ accountId: bank.id, categoryId: groceries.id, type: 'expense', amount: 20_000, date: `2026-${month}-02T12:00:00.000Z`, merchant: 'Private market', description: 'Monthly essentials' }, { clientId: `journey-expense-${month}` }); balance -= 20_000;
        assert.equal((await app.getSummary()).totalBalance, balance);
      }
      const input = { accountId: bank.id, categoryId: salary.id, type: 'income', amount: 50_000, date: '2026-11-02T12:00:00.000Z', merchant: 'Private employer', description: 'Income' };
      await app.transactions.createTransaction(input, { clientId: 'journey-income-current' });
      await app.transactions.createTransaction(input, { clientId: 'journey-income-current' });
      const expenseInput = { ...input, categoryId: groceries.id, type: 'expense', amount: 10_000, merchant: 'Private market', description: 'Current essentials' };
      expense = await app.transactions.createTransaction(expenseInput, { clientId: 'journey-expense-current' });
      await app.transactions.updateTransaction(expense.id, { ...expenseInput, amount: 12_000 }); assert.equal((await app.getSummary()).spend.thisMonthMTD, 12_000);
      await app.transactions.deleteTransaction(expense.id); assert.equal((await app.getSummary()).spend.thisMonthMTD, 0);
      expense = await app.transactions.createTransaction(expenseInput, { clientId: 'journey-expense-restored' });
      const before = await app.getSummary(); assert.equal(before.totalBalance, 380_000);
      const transfer = { sourceAccountId: bank.id, destinationAccountId: savingsAccount.id, amount: 30_000, date: '2026-11-10T12:00:00.000Z', description: 'Private transfer note' };
      await app.transfers.createTransfer(transfer, 'journey-transfer'); await app.transfers.createTransfer(transfer, 'journey-transfer');
      const after = await app.getSummary();
      assert.equal(after.totalBalance, before.totalBalance); assert.deepEqual(after.income, before.income); assert.deepEqual(after.spend, before.spend); assert.deepEqual(after.savings, before.savings);
      assert.equal((await app.catalog.listAccounts()).find(row => row.id === bank.id).balance, 350_000);
      assert.equal((await app.catalog.listAccounts()).find(row => row.id === savingsAccount.id).balance, 30_000);
      assert.equal((await app.openings.getState(bank.id)).candidate, 100_000);
      assert.equal((await app.openings.getState(savingsAccount.id)).candidate, 0);
    });
    await t.test('C: saved financial profile, targets, forecasts, recommendations, purchase and installment rules agree', async () => {
      const accountsBefore = await app.catalog.listAccounts(), txBefore = await app.transactions.listAllTransactions();
      await app.catalog.saveProfileSettings({ monthlyIncome: 50_000, emergencyFundTarget: 70_000 });
      laptop = await app.goals.createGoal({ name: 'Laptop', targetAmount: 500_000, targetDate: '2027-01-31T19:00:00.000Z' });
      await app.goals.updateGoalTarget(laptop.id, 600_000);
      const planning = await app.getSavingsPlanning();
      assert.equal(planning.goals.find(row => row.id === laptop.id).progress.current, 280_000);
      assert.equal(planning.goals.find(row => row.id === laptop.id).progress.remaining, 320_000);
      assert.equal(planning.analysis.recommendation.recommendedMonthlyTransfer, 20_000);
      assert.equal((await app.getForecast()).forecast.total.blend, 20_000);
      const affordable = await app.assess({ itemName: 'Purchase', price: 30_000, monthsAhead: 2 });
      assert.equal(affordable.result.buffer, 70_000); assert.equal(affordable.result.canAfford, true);
      assert.equal((await app.assess({ itemName: 'Purchase', price: 500_000, monthsAhead: 2 })).result.canAfford, false);
      await assert.rejects(app.assess({ itemName: 'Purchase', price: 30_000, monthsAhead: 0 }), /1 to 120/);
      assert.equal(assessRecordedInstallment(planning, { price: 72_000, months: 3, apr: 0 }).monthly, 24_000);
      assert.throws(() => assessRecordedInstallment(planning, { price: 72_000, months: 0, apr: 0 }));
      assert.deepEqual(await app.catalog.listAccounts(), accountsBefore); assert.deepEqual(await app.transactions.listAllTransactions(), txBefore);
    });
    await t.test('D: combined historical pages and dashboard refresh after detail mutations retain period distinctions', async () => {
      const filters = { type: 'expense', categoryId: groceries.id, accountId: bank.id, search: 'Monthly essentials', ...activityDateRange('range', '', '2026-08-01', '2026-11-01') };
      const first = await app.getActivity({ filters, pageSize: 2 }), second = await app.getActivity({ filters, pageSize: 2, cursor: first.nextCursor });
      assert.equal(first.items.length, 2); assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 3);
      for (const month of ['2026-08', '2026-09', '2026-10']) assert.equal((await app.getActivity({ filters: { type: 'expense', ...activityDateRange('month', month, '', '') } })).items.length, 1);
      const input = { accountId: bank.id, categoryId: groceries.id, type: 'expense', amount: 15_000, date: expense.date, merchant: 'Private market', description: 'Current essentials' };
      assert.equal((await app.transactions.getTransaction(expense.id)).amount, -10_000);
      await app.transactions.updateTransaction(expense.id, input); assert.equal((await app.getDashboard()).summary.value.savings.thisMonth, 35_000);
      await app.transactions.deleteTransaction(expense.id); assert.equal((await app.getDashboard()).summary.value.savings.thisMonth, 50_000);
      expense = await app.transactions.createTransaction({ ...input, amount: 10_000 }, { clientId: 'journey-final-expense' });
      const dashboard = await app.getDashboard(); assert.equal(dashboard.summary.value.spend.thisMonthMTD, 10_000); assert.equal(dashboard.projection, dashboard.summary.value.spend.thisMonthProjected);
      assert.equal(dashboard.forecast.value.forecast.total.blend, 20_000); assert.ok(!dashboard.trend.some(row => row.month === '2026-11'));
      assert.ok(dashboard.recent.value.items.length <= 5); assert.equal(dashboard.recent.value.items[0].kind, 'transfer');
    });
    await t.test('E: persistent chat uses the same records, clarification, grounded fallback and minimized payloads', async () => {
      const handler = createMobileChatHandler(async ({ prompt }) => {
        assert.doesNotMatch(prompt, /Private|clientId|merchant|description/); return JSON.stringify({ text: 'Invented PKR 999,999' });
      });
      const client = createChatClient({ endpoint: 'https://test.example/api/mobile-chat', getContext: app.getContext, fetch: async (url, init) => {
        const payload = JSON.parse(String(init.body)); assert.ok(payload.messages.length <= 12);
        assert.doesNotMatch(JSON.stringify(payload.context), /Private|clientId|merchant|description|accountId|userId/);
        return handler(new Request(String(url), init));
      } });
      let state; const session = createChatSession({ ...app.chatStore, chat: client, changed: value => { state = value; } }); await session.load();
      for (const [question, expected] of [
        ['How much did I spend this month?', /PKR 10,000/], ['What is my biggest spending category?', /groceries.*PKR 10,000/],
        ['How much did I save this month?', /PKR 40,000/], ['What is my forecast?', /PKR 20,000/],
        ['Can I afford PKR 30,000 in 2 months?', /preserves your emergency buffer/], ['Can I afford PKR 30,000?', /how many months/],
        ['What if I wait two months?', /purchase of PKR 30,000 in 2 months/],
      ]) {
        await session.send(question); assert.equal(state.error, null); assert.match(state.messages.at(-1).content, expected); assert.equal(state.mode, 'deterministic');
        assert.doesNotMatch(state.messages.at(-1).content, /999,999/);
      }
      conversationId = await app.chatStore.getOrCreateConversation(); assert.equal((await app.chatStore.listMessages(conversationId)).length, 14);
      const route = readFileSync(new URL('../../src/app/api/mobile-chat/route.ts', import.meta.url), 'utf8');
      assert.doesNotMatch(route, /prisma|DEMO_USER|buildTools/); assert.match(route, /process\.env\.GROQ_API_KEY/);
    });
    await t.test('persistence: migration rerun and seed preserve every financial row, profile, target and conversation after close/reopen', async () => {
      const before = { accounts: await app.catalog.listAccounts(), profile: await app.catalog.getProfile(), goals: await app.goals.listGoals(), transactions: await app.transactions.listAllTransactions(), transfers: await app.transfers.listTransfers(), summary: await app.getSummary() };
      sqlite.close(); sqlite = new Database(path); sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite); app = product(sqlite); await seedLocalProfile(app.database);
      assert.deepEqual({ accounts: await app.catalog.listAccounts(), profile: await app.catalog.getProfile(), goals: await app.goals.listGoals(), transactions: await app.transactions.listAllTransactions(), transfers: await app.transfers.listTransfers(), summary: await app.getSummary() }, before);
      assert.equal((await app.chatStore.listMessages(conversationId)).length, 14);
      assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    });
  } finally { if (sqlite?.open) sqlite.close(); unlinkSync(path); rmdirSync(directory); }
});

test('integration ownership regression: malformed account relationships cannot leak through detail, full reporting or chat reads', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite); const app = product(sqlite); await seedLocalProfile(app.database);
    await app.database.insert(schema.users).values({ id: 2, email: 'other@example.test', name: 'Other' });
    const [foreign] = await app.database.insert(schema.accounts).values({ userId: 2, name: 'Other private account', type: 'checking', balance: 0 }).returning();
    const [broken] = await app.database.insert(schema.transactions).values({ clientId: 'broken-owner', userId: 1, accountId: foreign.id, date: '2026-11-02T12:00:00.000Z', type: 'income', amount: 100 }).returning();
    for (const read of [() => app.transactions.getTransaction(broken.id), app.transactions.listAllTransactions, () => app.transactions.listTransactions(100), app.getContext]) await assert.rejects(read(), /ownership is inconsistent/);
    assert.deepEqual((await app.getActivity()).items, []);
    const dashboard = await app.getDashboard(); assert.equal(dashboard.summary.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(dashboard), /Other private account/);
  } finally { sqlite.close(); }
});
