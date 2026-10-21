import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { MAX_PKR_AMOUNT } from '../src/lib/validation/transaction.ts';
import { createMissingProfileRecoveryService } from '../src/lib/services/history-start-recovery-core.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;
const validInput = { monthlyIncome: 50_000, emergencyFundTarget: 120_000 };

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'recovery-local@example.test', name: 'Recovery Local' },
      { id: otherUserId, email: 'recovery-other@example.test', name: 'Recovery Other' },
    ]);
    await run({ sqlite, database });
  } finally {
    sqlite.close();
  }
}

function recovery(database, overrides = {}) {
  return createMissingProfileRecoveryService(database, { userId: localUserId, ...overrides });
}

test('profile recovery: creates only an unconfirmed owned profile with supplied values', async () => {
  await withFixture(async ({ database }) => {
    const result = await recovery(database).recoverMissingProfile(validInput);

    assert.deepEqual(result, {
      status: 'recovered',
      profile: {
        userId: localUserId,
        monthlyIncome: 50_000,
        emergencyFundTarget: 120_000,
        financialHistoryStartedAt: null,
      },
    });
    const [stored] = await database.select().from(schema.userProfiles);
    assert.equal(stored.userId, localUserId);
    assert.equal(stored.monthlyIncome, 50_000);
    assert.equal(stored.emergencyFundTarget, 120_000);
    assert.equal(stored.financialHistoryStartedAt, null);
  });
});

test('profile recovery: accepts explicitly supplied zero values', async () => {
  await withFixture(async ({ database }) => {
    assert.equal((await recovery(database).recoverMissingProfile({
      monthlyIncome: 0,
      emergencyFundTarget: 0,
    })).status, 'recovered');

    const [stored] = await database.select().from(schema.userProfiles);
    assert.equal(stored.monthlyIncome, 0);
    assert.equal(stored.emergencyFundTarget, 0);
    assert.equal(stored.financialHistoryStartedAt, null);
  });
});

test('profile recovery: rejects missing and invalid financial inputs before writes', async () => {
  await withFixture(async ({ database }) => {
    const recover = recovery(database).recoverMissingProfile;
    const invalidInputs = [
      {},
      { monthlyIncome: 1 },
      { emergencyFundTarget: 1 },
      { monthlyIncome: -1, emergencyFundTarget: 1 },
      { monthlyIncome: 1, emergencyFundTarget: -1 },
      { monthlyIncome: 1.5, emergencyFundTarget: 1 },
      { monthlyIncome: 1, emergencyFundTarget: 1.5 },
      { monthlyIncome: Number.NaN, emergencyFundTarget: 1 },
      { monthlyIncome: 1, emergencyFundTarget: Number.POSITIVE_INFINITY },
      { monthlyIncome: MAX_PKR_AMOUNT + 1, emergencyFundTarget: 1 },
      { monthlyIncome: 1, emergencyFundTarget: MAX_PKR_AMOUNT + 1 },
      { monthlyIncome: '5000', emergencyFundTarget: 1 },
    ];

    for (const input of invalidInputs) {
      const result = await recover(input);
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason, 'invalid_input');
      assert.ok(result.invalidFields.length > 0);
    }
    assert.equal((await database.select().from(schema.userProfiles)).length, 0);
  });
});

test('profile recovery: protects an existing confirmed profile without overwriting it', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values({
      userId: localUserId,
      monthlyIncome: 7_000,
      emergencyFundTarget: 8_000,
      financialHistoryStartedAt: '2026-04-30T19:00:00.000Z',
    });
    const before = sqlite.serialize();

    assert.deepEqual(await recovery(database).recoverMissingProfile(validInput), {
      status: 'rejected',
      reason: 'profile_exists',
    });
    assert.deepEqual(sqlite.serialize(), before);
  });
});

test('profile recovery: repeated and concurrent calls create at most one profile', async () => {
  await withFixture(async ({ database }) => {
    const recover = recovery(database).recoverMissingProfile;
    const [first, second] = await Promise.all([recover(validInput), recover(validInput)]);

    assert.deepEqual([first.status, second.status].sort(), ['recovered', 'rejected']);
    const rejected = first.status === 'rejected' ? first : second;
    assert.equal(rejected.reason, 'profile_exists');
    assert.deepEqual(await recover(validInput), { status: 'rejected', reason: 'profile_exists' });
    assert.equal((await database.select().from(schema.userProfiles)).length, 1);
  });
});

test('profile recovery: forced post-insert failure rolls the profile back', async () => {
  await withFixture(async ({ database }) => {
    const operation = recovery(database, {
      afterProfileInsert: () => { throw new Error('forced recovery failure'); },
    });

    assert.deepEqual(await operation.recoverMissingProfile(validInput), {
      status: 'rejected',
      reason: 'write_failed',
    });
    assert.equal((await database.select().from(schema.userProfiles)).length, 0);
  });
});

test('profile recovery: missing configured user rejects without affecting another user', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values({
      userId: otherUserId,
      monthlyIncome: 9_000,
      emergencyFundTarget: 10_000,
      financialHistoryStartedAt: null,
    });
    const before = sqlite.serialize();
    const missingUser = createMissingProfileRecoveryService(database, { userId: 303 });

    assert.deepEqual(await missingUser.recoverMissingProfile(validInput), {
      status: 'rejected',
      reason: 'user_not_found',
    });
    assert.deepEqual(sqlite.serialize(), before);
  });
});

test('profile recovery: preserves accounts, transactions, balances, and audit records', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Recovery Cash', type: 'cash', balance: 250,
    });
    await database.insert(schema.transactions).values({
      clientId: 'recovery-existing', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 250, type: 'income',
    });
    await database.insert(schema.financialHistoryStartAudit).values({
      userId: localUserId,
      previousStartedAt: null,
      newStartedAt: '2026-01-01T00:00:00.000Z',
      changeKind: 'confirmation',
      changedAt: '2026-01-02T00:00:00.000Z',
    });
    const accountsBefore = await database.select().from(schema.accounts);
    const transactionsBefore = await database.select().from(schema.transactions);
    const auditBefore = await database.select().from(schema.financialHistoryStartAudit);

    assert.equal((await recovery(database).recoverMissingProfile(validInput)).status, 'recovered');

    assert.deepEqual(await database.select().from(schema.accounts), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions), transactionsBefore);
    assert.deepEqual(await database.select().from(schema.financialHistoryStartAudit), auditBefore);
  });
});

test('profile recovery: history-state reads never trigger recovery', async () => {
  await withFixture(async ({ database }) => {
    const state = createHistoryStartStateService(database, {
      userId: localUserId,
      now: () => new Date('2026-10-20T12:00:00.000Z'),
    });

    assert.deepEqual(await state.getFinancialHistoryState(), { status: 'missing_profile' });
    assert.equal((await database.select().from(schema.userProfiles)).length, 0);

    assert.equal((await recovery(database).recoverMissingProfile(validInput)).status, 'recovered');
    assert.deepEqual(await state.getFinancialHistoryState(), {
      status: 'unconfirmed',
      reason: 'history_start_unconfirmed',
      suggestion: null,
    });
  });
});
