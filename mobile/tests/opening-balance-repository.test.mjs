import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createOpeningBalanceRepository } from '../src/lib/repositories/opening-balances-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.users).values([{ id: 1, email: 'a@test', name: 'A' }, { id: 2, email: 'b@test', name: 'B' }]);
    await db.insert(schema.accounts).values([{ id: 1, userId: 1, name: 'Main', type: 'checking', balance: 850 }, { id: 2, userId: 1, name: 'Savings', type: 'savings', balance: 150 }, { id: 3, userId: 2, name: 'Private', type: 'cash', balance: 50 }]);
    const repository = createOpeningBalanceRepository(db, { userId: 1, now: () => new Date('2026-10-21T00:00:00.000Z') });
    await run({ sqlite, db, repository });
  } finally { sqlite.close(); }
}

test('reconciliation counts ordinary and both dedicated transfer effects once', async () => fixture(async ({ db, repository }) => {
  await db.insert(schema.transactions).values([{ clientId: 'income', userId: 1, accountId: 1, date: '2020-01-01T00:00:00.000Z', amount: 100, type: 'income' }, { clientId: 'expense', userId: 1, accountId: 1, date: '2026-01-01T00:00:00.000Z', amount: -50, type: 'expense' }]);
  await db.insert(schema.transfers).values({ clientId: 'move', userId: 1, sourceAccountId: 1, destinationAccountId: 2, amount: 100, date: '2026-01-02T00:00:00.000Z' });
  assert.equal((await repository.getState(1)).candidate, 900);
  assert.equal((await repository.getState(2)).candidate, 50);
}));

test('legacy transfers make reconciliation ambiguous and block confirmation', async () => fixture(async ({ db, repository }) => {
  await db.insert(schema.transactions).values({ clientId: 'legacy', userId: 1, accountId: 1, date: '2026-01-01T00:00:00.000Z', amount: -10, type: 'transfer' });
  assert.equal((await repository.getState(1)).status, 'ambiguous');
  await assert.rejects(repository.confirm(1, 10), /ambiguous/i);
}));

test('confirmation and correction preserve activity, audit changes, and permit a negative balance', async () => fixture(async ({ sqlite, repository }) => {
  assert.deepEqual(await repository.confirm(1, 850), { openingBalance: 850, currentBalance: 850 });
  assert.deepEqual(await repository.correct(1, 850, -100), { openingBalance: -100, currentBalance: -100 });
  assert.deepEqual(sqlite.prepare('SELECT account_id accountId, previous_opening_balance previousValue, new_opening_balance newValue, change_kind kind, changed_at changedAt FROM opening_balance_audit ORDER BY id').all(), [
    { accountId: 1, previousValue: null, newValue: 850, kind: 'confirmation', changedAt: '2026-10-21T00:00:00.000Z' },
    { accountId: 1, previousValue: 850, newValue: -100, kind: 'correction', changedAt: '2026-10-21T00:00:00.000Z' },
  ]);
  await assert.rejects(repository.correct(1, 850, 0), /changed/i);
}));

test('audit failure rolls back balance and opening state', async () => fixture(async ({ sqlite, repository }) => {
  sqlite.exec('CREATE TRIGGER fail_audit BEFORE INSERT ON opening_balance_audit BEGIN SELECT RAISE(ABORT, \'audit failure\'); END;');
  await assert.rejects(repository.confirm(1, 800), /audit failure/i);
  assert.deepEqual(sqlite.prepare('SELECT balance, opening_balance openingBalance FROM accounts WHERE id=1').get(), { balance: 850, openingBalance: null });
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM opening_balance_audit').get().count, 0);
}));

test('ownership and unsafe values fail without writes', async () => fixture(async ({ repository }) => {
  assert.equal((await repository.getState(3)).status, 'missing_account');
  await assert.rejects(repository.confirm(3, 0), /not found/i);
  await assert.rejects(repository.confirm(1, Number.MAX_SAFE_INTEGER + 1), /safe integer/i);
}));

test('cross-user dedicated account relationship makes reconciliation unavailable', async () => fixture(async ({ db, repository }) => {
  await db.insert(schema.transfers).values({ clientId: 'bad-owner', userId: 1, sourceAccountId: 1, destinationAccountId: 3, amount: 10, date: '2026-01-01T00:00:00.000Z' });
  const state = await repository.getState(1);
  assert.equal(state.status, 'ambiguous');
  assert.equal(state.reason, 'invalid_transfer');
}));

test('malformed persisted transfer returns typed ambiguity', async () => fixture(async ({ sqlite, repository }) => {
  const insert = 'INSERT INTO transfers(client_id,user_id,source_account_id,destination_account_id,amount,date) VALUES(?,?,?,?,?,?)';
  sqlite.prepare(insert).run('malformed', 1, 1, 2, 10, 'bad-date');
  const state = await repository.getState(1);
  assert.equal(state.status, 'ambiguous');
  assert.equal(state.reason, 'invalid_transfer');
}));
