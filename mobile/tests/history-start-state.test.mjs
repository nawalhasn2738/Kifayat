import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import {
  createHistoryStartStateService,
  HISTORY_START_UNCONFIRMED_REASON,
} from '../src/lib/services/history-start-state-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;
const now = new Date('2026-10-20T12:00:00.000Z');

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'history-local@example.test', name: 'History Local' },
      { id: otherUserId, email: 'history-other@example.test', name: 'History Other' },
    ]);
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local Cash', type: 'cash', balance: 0 },
      { id: 2, userId: otherUserId, name: 'Other Cash', type: 'cash', balance: 0 },
    ]);
    await run({ sqlite, database });
  } finally {
    sqlite.close();
  }
}

function service(database, userId = localUserId) {
  return createHistoryStartStateService(database, { userId, now: () => new Date(now) });
}

function profile(userId, financialHistoryStartedAt = null) {
  return {
    userId,
    monthlyIncome: 5000,
    emergencyFundTarget: 9000,
    financialHistoryStartedAt,
  };
}

test('history state: fails closed when the scoped user profile is missing', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(otherUserId));
    await database.insert(schema.transactions).values({
      clientId: 'other-private', userId: otherUserId, accountId: 2,
      date: '2020-01-01T00:00:00.000Z', amount: 100, type: 'income',
    });

    assert.deepEqual(await service(database).getFinancialHistoryState(), {
      status: 'missing_profile',
    });
  });
});

test('history state: returns unconfirmed with no suggestion for an empty owned ledger', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId));

    assert.deepEqual(await service(database).getFinancialHistoryState(), {
      status: 'unconfirmed',
      reason: HISTORY_START_UNCONFIRMED_REASON,
      suggestion: null,
    });
  });
});

test('history state: returns a valid confirmed value and Karachi display date', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values([
      profile(localUserId, '2026-04-30T19:00:00.000Z'),
      profile(otherUserId, 'not-a-date'),
    ]);

    assert.deepEqual(await service(database).getFinancialHistoryState(), {
      status: 'confirmed',
      value: '2026-04-30T19:00:00.000Z',
      calendarDate: '2026-05-01',
    });
  });
});

test('history state: invalid or future persisted values fail closed', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId, 'not-a-date'));
    const read = service(database).getFinancialHistoryState;

    assert.deepEqual(await read(), {
      status: 'invalid',
      reason: 'invalid_history_start',
    });

    await database.update(schema.userProfiles)
      .set({ financialHistoryStartedAt: '2026-10-20T12:00:00.001Z' });
    assert.deepEqual(await read(), {
      status: 'invalid',
      reason: 'invalid_history_start',
    });
  });
});

test('history state: suggests the earliest valid owned transaction Karachi date only', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values([
      profile(localUserId),
      profile(otherUserId),
    ]);
    await database.insert(schema.transactions).values([
      { clientId: 'local-later', userId: localUserId, accountId: 1, date: '2026-05-03T12:00:00.000Z', amount: 50, type: 'income' },
      { clientId: 'local-earliest', userId: localUserId, accountId: 1, date: '2026-04-30T18:59:59.999Z', amount: -10, type: 'expense' },
      { clientId: 'other-earlier', userId: otherUserId, accountId: 2, date: '2020-01-01T00:00:00.000Z', amount: 100, type: 'income' },
      { clientId: 'other-invalid', userId: otherUserId, accountId: 2, date: 'not-a-date', amount: 100, type: 'income' },
    ]);

    assert.deepEqual(await service(database).getFinancialHistoryState(), {
      status: 'unconfirmed',
      reason: HISTORY_START_UNCONFIRMED_REASON,
      suggestion: {
        value: '2026-04-29T19:00:00.000Z',
        calendarDate: '2026-04-30',
        sourceTransactionDate: '2026-04-30T18:59:59.999Z',
      },
    });
  });
});

test('history state: any invalid owned transaction date blocks the suggestion', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId));
    await database.insert(schema.transactions).values({
      clientId: 'valid-earliest', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 100, type: 'income',
    });
    sqlite.prepare(`
      INSERT INTO transactions (client_id, user_id, account_id, date, amount, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('invalid-later', localUserId, 1, '2026-02-30T00:00:00.000Z', -25, 'expense');

    assert.deepEqual(await service(database).getFinancialHistoryState(), {
      status: 'transaction_history_invalid',
    });
  });
});

test('history state: all status and suggestion reads leave the database unchanged', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId));
    await database.insert(schema.transactions).values({
      clientId: 'read-only', userId: localUserId, accountId: 1,
      date: '2026-03-10T08:00:00.000Z', amount: 100, type: 'income',
    });
    const before = sqlite.serialize();

    const result = await service(database).getFinancialHistoryState();

    assert.equal(result.status, 'unconfirmed');
    assert.deepEqual(sqlite.serialize(), before);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_history_start_audit').get().count,
      0,
    );
  });
});
