import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createHistoryStartCommandService } from '../src/lib/services/history-start-commands-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;
const now = new Date('2026-10-20T12:00:00.000Z');
const mayStart = '2026-04-30T19:00:00.000Z';
const juneStart = '2026-05-31T19:00:00.000Z';

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'commands-local@example.test', name: 'Commands Local' },
      { id: otherUserId, email: 'commands-other@example.test', name: 'Commands Other' },
    ]);
    await run({ sqlite, database });
  } finally {
    sqlite.close();
  }
}

function commands(database, overrides = {}) {
  return createHistoryStartCommandService(database, {
    userId: localUserId,
    now: () => new Date(now),
    ...overrides,
  });
}

function profile(userId = localUserId, financialHistoryStartedAt = null) {
  return {
    userId,
    monthlyIncome: 50_000,
    emergencyFundTarget: 120_000,
    financialHistoryStartedAt,
  };
}

test('history commands: confirmation sets the canonical value and exact audit event atomically', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile());

    assert.deepEqual(await commands(database).confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'confirmed',
      value: mayStart,
    });
    const [stored] = await database.select().from(schema.userProfiles);
    assert.equal(stored.financialHistoryStartedAt, mayStart);
    assert.deepEqual((await database.select().from(schema.financialHistoryStartAudit)).map((row) => ({
      userId: row.userId,
      previousStartedAt: row.previousStartedAt,
      newStartedAt: row.newStartedAt,
      changeKind: row.changeKind,
      changedAt: row.changedAt,
    })), [{
      userId: localUserId,
      previousStartedAt: null,
      newStartedAt: mayStart,
      changeKind: 'confirmation',
      changedAt: now.toISOString(),
    }]);
  });
});

test('history commands: correction records old and new canonical values', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId, mayStart));

    assert.deepEqual(await commands(database).correctHistoryStart({
      calendarDate: '2026-06-01',
      expectedCurrentValue: mayStart,
    }), {
      status: 'corrected',
      previousValue: mayStart,
      value: juneStart,
    });
    const [stored] = await database.select().from(schema.userProfiles);
    assert.equal(stored.financialHistoryStartedAt, juneStart);
    const [audit] = await database.select().from(schema.financialHistoryStartAudit);
    assert.equal(audit.previousStartedAt, mayStart);
    assert.equal(audit.newStartedAt, juneStart);
    assert.equal(audit.changeKind, 'correction');
    assert.equal(audit.changedAt, now.toISOString());
  });
});

test('history commands: invalid, future, and clear inputs are rejected before writes', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values(profile());
    const operation = commands(database);
    const before = sqlite.serialize();

    for (const calendarDate of [null, '', '2026-5-01', '2025-02-29', '2026-02-30']) {
      assert.deepEqual(await operation.confirmHistoryStart({ calendarDate }), {
        status: 'rejected', reason: 'invalid_calendar_date',
      });
    }
    assert.deepEqual(await operation.confirmHistoryStart({ calendarDate: '2026-10-21' }), {
      status: 'rejected', reason: 'future_date',
    });
    assert.deepEqual(sqlite.serialize(), before);
  });
});

test('history commands: missing profile and invalid persisted state fail closed', async () => {
  await withFixture(async ({ database }) => {
    const operation = commands(database);
    assert.deepEqual(await operation.confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'rejected', reason: 'missing_profile',
    });
    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: mayStart,
    }), { status: 'rejected', reason: 'missing_profile' });

    await database.insert(schema.userProfiles).values(profile(localUserId, 'not-a-date'));
    assert.deepEqual(await operation.confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'rejected', reason: 'invalid_history_start',
    });
    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: mayStart,
    }), { status: 'rejected', reason: 'invalid_history_start' });
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 0);
  });
});

test('history commands: confirmation and correction enforce their current-state transitions', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile());
    const operation = commands(database);

    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: mayStart,
    }), { status: 'rejected', reason: 'unconfirmed' });
    assert.deepEqual(await operation.confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'confirmed', value: mayStart,
    });
    assert.deepEqual(await operation.confirmHistoryStart({ calendarDate: '2026-06-01' }), {
      status: 'rejected', reason: 'already_confirmed',
    });
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 1);
  });
});

test('history commands: correction rejects invalid expected, stale, and canonical no-op values', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId, mayStart));
    const operation = commands(database);

    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: '2026-05-01T00:00:00.000+05:00',
    }), { status: 'rejected', reason: 'invalid_expected_value' });
    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: '2026-03-31T19:00:00.000Z',
    }), { status: 'rejected', reason: 'stale_value' });
    const beforeNoOp = sqlite.serialize();
    assert.deepEqual(await operation.correctHistoryStart({
      calendarDate: '2026-05-01', expectedCurrentValue: mayStart,
    }), { status: 'rejected', reason: 'no_change' });
    assert.deepEqual(sqlite.serialize(), beforeNoOp);
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 0);
  });
});

test('history commands: forced failures roll back profile and audit writes and permit retry', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile());
    const failing = commands(database, {
      afterAuditInsert: () => { throw new Error('forced command failure'); },
    });

    assert.deepEqual(await failing.confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'rejected', reason: 'write_failed',
    });
    assert.equal((await database.select().from(schema.userProfiles))[0].financialHistoryStartedAt, null);
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 0);

    assert.deepEqual(await commands(database).confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'confirmed', value: mayStart,
    });
  });

  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId, mayStart));
    const failing = commands(database, {
      afterAuditInsert: () => { throw new Error('forced correction failure'); },
    });

    assert.deepEqual(await failing.correctHistoryStart({
      calendarDate: '2026-06-01', expectedCurrentValue: mayStart,
    }), { status: 'rejected', reason: 'write_failed' });
    assert.equal((await database.select().from(schema.userProfiles))[0].financialHistoryStartedAt, mayStart);
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 0);
  });
});

test('history commands: configured-user ownership isolates other profiles', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.userProfiles).values(profile(otherUserId));
    const before = sqlite.serialize();

    assert.deepEqual(await commands(database).confirmHistoryStart({ calendarDate: '2026-05-01' }), {
      status: 'rejected', reason: 'missing_profile',
    });
    assert.deepEqual(sqlite.serialize(), before);
  });
});

test('history commands: concurrent confirmations create one confirmation audit event', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile());
    const confirm = commands(database).confirmHistoryStart;
    const results = await Promise.all([
      confirm({ calendarDate: '2026-05-01' }),
      confirm({ calendarDate: '2026-06-01' }),
    ]);

    assert.equal(results.filter((result) => result.status === 'confirmed').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 1);
  });
});

test('history commands: concurrent corrections cannot overwrite a newer value silently', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile(localUserId, mayStart));
    const correct = commands(database).correctHistoryStart;
    const results = await Promise.all([
      correct({ calendarDate: '2026-06-01', expectedCurrentValue: mayStart }),
      correct({ calendarDate: '2026-07-01', expectedCurrentValue: mayStart }),
    ]);

    assert.equal(results.filter((result) => result.status === 'corrected').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason, 'stale_value');
    assert.equal((await database.select().from(schema.financialHistoryStartAudit)).length, 1);
  });
});

test('history commands: successful writes leave ledger and balances unchanged', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.userProfiles).values(profile());
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Command Cash', type: 'cash', balance: 200,
    });
    await database.insert(schema.transactions).values({
      clientId: 'command-existing', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 200, type: 'income',
    });
    const accountsBefore = await database.select().from(schema.accounts);
    const transactionsBefore = await database.select().from(schema.transactions);
    const [profileBefore] = await database.select().from(schema.userProfiles);

    assert.equal((await commands(database).confirmHistoryStart({
      calendarDate: '2026-05-01',
    })).status, 'confirmed');

    assert.deepEqual(await database.select().from(schema.accounts), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions), transactionsBefore);
    const [profileAfter] = await database.select().from(schema.userProfiles);
    assert.equal(profileAfter.monthlyIncome, profileBefore.monthlyIncome);
    assert.equal(profileAfter.emergencyFundTarget, profileBefore.emergencyFundTarget);
  });
});
