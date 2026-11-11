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
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createSummaryService, calculateRisk } from '../src/lib/services/finance-core.ts';
import { createAffordabilityService } from '../src/lib/services/affordability-core.ts';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema }); await seedLocalProfile(database);
    await run({ sqlite, database, repository: createCatalogRepository(database) });
  } finally { sqlite.close(); }
}

test('profile repository: loads defaults, preserves edits through seeding and repository reload', async () => {
  await fixture(async ({ database, repository }) => {
    assert.deepEqual(await repository.getProfileSettings(), { monthlyIncome: 120_000, emergencyFundTarget: 240_000 });
    await repository.saveProfileSettings({ monthlyIncome: 0, emergencyFundTarget: 123_456 });
    await seedLocalProfile(database); await seedLocalProfile(database);
    const reloaded = createCatalogRepository(database);
    assert.deepEqual(await reloaded.getProfileSettings(), { monthlyIncome: 0, emergencyFundTarget: 123_456 });
    assert.equal((await database.select().from(schema.userProfiles)).length, 1);
  });
});

test('profile repository: validates before writes and preserves unrelated profile fields', async () => {
  await fixture(async ({ database, repository }) => {
    await database.update(schema.userProfiles).set({ dependents: 2, riskTolerance: 'low', notesAboutSelf: 'Keep', financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
    const before = await repository.getProfile();
    for (const input of [{}, { monthlyIncome: -1, emergencyFundTarget: 1 }, { monthlyIncome: 1, emergencyFundTarget: null },
      { monthlyIncome: 1.5, emergencyFundTarget: 2 }, { monthlyIncome: 2_147_483_648, emergencyFundTarget: 0 }]) {
      await assert.rejects(repository.saveProfileSettings(input));
      assert.deepEqual(await repository.getProfile(), before);
    }
    await repository.saveProfileSettings({ monthlyIncome: 20_000, emergencyFundTarget: 0 });
    assert.deepEqual(await repository.getProfile(), { ...before, monthlyIncome: 20_000, emergencyFundTarget: 0 });
  });
});

test('profile repository: fixed local-user ownership ignores supplied identities and rejects missing profiles', async () => {
  await fixture(async ({ database, repository }) => {
    await database.insert(schema.users).values({ id: 2, email: 'other@example.test', name: 'Other' });
    await database.insert(schema.userProfiles).values({ userId: 2, monthlyIncome: 900, emergencyFundTarget: 800 });
    const other = createCatalogRepository(database, { userId: 2 });
    await repository.saveProfileSettings({ userId: 2, id: 2, monthlyIncome: 0, emergencyFundTarget: 0 });
    assert.deepEqual(await other.getProfileSettings(), { monthlyIncome: 900, emergencyFundTarget: 800 });
    assert.deepEqual(await repository.getProfileSettings(), { monthlyIncome: 0, emergencyFundTarget: 0 });
    await database.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, 1));
    assert.equal(await repository.getProfileSettings(), null);
    await assert.rejects(repository.saveProfileSettings({ monthlyIncome: 1, emergencyFundTarget: 1 }), /missing/);
    await seedLocalProfile(database);
    assert.equal(await repository.getProfileSettings(), null);
    assert.deepEqual(await other.getProfileSettings(), { monthlyIncome: 900, emergencyFundTarget: 800 });
  });
});

test('profile repository: failed SQLite save is atomic', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const before = await repository.getProfile();
    sqlite.exec("CREATE TRIGGER reject_profile BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    await assert.rejects(repository.saveProfileSettings({ monthlyIncome: 0, emergencyFundTarget: 0 }));
    assert.deepEqual(await repository.getProfile(), before);
  });
});

test('profile repository: saved zero and maximum persist after closing and reopening a disposable database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kifayat-profile-test-'));
  const path = join(directory, 'profile-fixture.sqlite');
  let sqlite;
  try {
    sqlite = new Database(path); await migrateWithExpoPath(sqlite);
    let database = drizzle(sqlite, { schema }); await seedLocalProfile(database);
    await createCatalogRepository(database).saveProfileSettings({ monthlyIncome: 0, emergencyFundTarget: 2_147_483_647 });
    sqlite.close(); sqlite = new Database(path); database = drizzle(sqlite, { schema });
    await seedLocalProfile(database);
    assert.deepEqual(await createCatalogRepository(database).getProfileSettings(), { monthlyIncome: 0, emergencyFundTarget: 2_147_483_647 });
  } finally { if (sqlite?.open) sqlite.close(); unlinkSync(path); rmdirSync(directory); }
});

test('profile services: current saved income reaches risk, emergency target reaches affordability, forecast and ledger stay unchanged', async () => {
  await fixture(async ({ database, repository }) => {
    const now = () => new Date('2026-11-11T12:00:00.000Z');
    await database.update(schema.userProfiles).set({ financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
    const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.type, 'checking'));
    await database.update(schema.accounts).set({ balance: 200_000 }).where(eq(schema.accounts.id, account.id));
    for (const [index, date] of ['2026-08-02', '2026-09-02', '2026-10-02', '2026-11-02'].entries()) {
      await database.insert(schema.transactions).values({ clientId: `profile-expense-${index}`, userId: 1, accountId: account.id,
        date: `${date}T12:00:00.000Z`, type: 'expense', amount: -20_000 });
    }
    const transactions = createTransactionRepository(database, { userId: 1, now });
    const getSummary = createSummaryService({ listAccounts: repository.listAccounts, listAllTransactions: transactions.listAllTransactions, now });
    const history = createHistoryStartStateService(database, { userId: 1, now });
    const getForecast = createForecastReadinessService({ getFinancialHistoryState: history.getFinancialHistoryState, listAllTransactions: transactions.listAllTransactions, now });
    const assess = createAffordabilityService({ getSummary, getForecast, getProfile: repository.getProfile, listActiveAccounts: repository.listActiveAccounts });
    const risk = async () => calculateRisk(await getSummary(), await repository.getProfile(), await repository.listCategories(), await transactions.listAllTransactions(), now());
    const accountRows = await database.select().from(schema.accounts);
    const transactionRows = await database.select().from(schema.transactions);
    const goalRows = await database.select().from(schema.savingsGoals);
    const forecast = await getForecast(); const originalRisk = await risk();
    const before = await assess({ itemName: 'Purchase', price: 50_000, monthsAhead: 1 });
    assert.equal(before.result.buffer, 240_000); assert.equal(before.result.canAfford, false);
    await repository.saveProfileSettings({ monthlyIncome: 20_000, emergencyFundTarget: 30_000 });
    const after = await assess({ itemName: 'Purchase', price: 50_000, monthsAhead: 1 });
    assert.equal(after.result.buffer, 60_000); assert.equal(after.result.canAfford, true);
    assert.ok((await risk()).score > originalRisk.score);
    await repository.saveProfileSettings({ monthlyIncome: 0, emergencyFundTarget: 0 });
    assert.equal((await assess({ itemName: 'Purchase', price: 50_000, monthsAhead: 1 })).result.buffer, 60_000);
    assert.ok(Number.isFinite((await risk()).score));
    assert.deepEqual(await getForecast(), forecast);
    assert.deepEqual(await database.select().from(schema.accounts), accountRows);
    assert.deepEqual(await database.select().from(schema.transactions), transactionRows);
    assert.deepEqual(await database.select().from(schema.savingsGoals), goalRows);
  });
});
