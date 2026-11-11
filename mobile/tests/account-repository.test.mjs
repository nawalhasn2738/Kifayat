import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { AccountLifecycleError, createAccountRepository } from '../src/lib/repositories/accounts-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;
const now = new Date('2026-11-03T12:00:00.000Z');

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'local-account@example.test', name: 'Local User' },
      { id: otherUserId, email: 'other-account@example.test', name: 'Other User' },
    ]);
    await run({
      database,
      repository: createAccountRepository(database, { userId: localUserId, now: () => now }),
    });
  } finally {
    sqlite.close();
  }
}

test('account repository: conditional rename, archive, and restore work without driver-specific run results', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Cash', type: 'cash', balance: 50 },
      { id: 2, userId: localUserId, name: 'Bank', type: 'checking', balance: 0 },
    ]);
    await database.insert(schema.transactions).values({
      clientId: 'archive-history',
      userId: localUserId,
      accountId: 1,
      date: '2026-11-01',
      amount: 50,
      type: 'income',
      description: 'Preserved history',
    });

    await repository.renameAccount(1, 'Cash', 'Wallet');
    await repository.archiveAccount(1);
    let [wallet] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1));
    assert.equal(wallet.name, 'Wallet');
    assert.equal(wallet.balance, 50);
    assert.equal(wallet.archivedAt, now.toISOString());
    const history = await database.select().from(schema.transactions)
      .where(eq(schema.transactions.accountId, 1));
    assert.equal(history.length, 1);
    assert.equal(history[0].amount, 50);

    await repository.restoreAccount(1, now.toISOString());
    [wallet] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1));
    assert.equal(wallet.archivedAt, null);
  });
});

test('account repository: deletion remains owned and limited to unused null-opening accounts', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Keep', type: 'checking', balance: 0 },
      { id: 2, userId: localUserId, name: 'Disposable', type: 'cash', balance: 0 },
      { id: 3, userId: otherUserId, name: 'Other Private', type: 'cash', balance: 0 },
    ]);

    await repository.deleteUnusedAccount(2);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 2))).length, 0);

    await assert.rejects(
      repository.deleteUnusedAccount(3),
      (error) => error instanceof AccountLifecycleError && error.code === 'account_not_found',
    );
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 3))).length, 1);
  });
});

test('account repository: creation records balance and rejects case-insensitive duplicate names', async () => {
  await withFixture(async ({ database, repository }) => {
    const created = await repository.createAccount({
      name: 'Savings Pot',
      type: 'savings',
      openingBalance: 12500,
    });
    assert.equal(created.name, 'Savings Pot');
    assert.equal(created.type, 'savings');
    assert.equal(created.balance, 12500);
    assert.equal(created.openingBalance, 12500);
    assert.equal(created.archivedAt, null);

    const audit = await database.select().from(schema.openingBalanceAudit)
      .where(eq(schema.openingBalanceAudit.accountId, created.id));
    assert.deepEqual(audit.map((row) => ({
      previous: row.previousOpeningBalance,
      next: row.newOpeningBalance,
      kind: row.changeKind,
    })), [{ previous: null, next: 12500, kind: 'confirmation' }]);

    await assert.rejects(
      repository.createAccount({ name: '  savings pot ', type: 'cash', openingBalance: 0 }),
      (error) => error instanceof AccountLifecycleError && error.code === 'duplicate_name',
    );
  });
});

test('account repository: deletion rejection preserves financial state', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 0,
    });
    const created = await repository.createAccount({
      name: 'Opening funds', type: 'cash', openingBalance: 400,
    });

    await assert.rejects(
      repository.deleteUnusedAccount(created.id),
      (error) => error instanceof AccountLifecycleError && error.code === 'account_in_use',
    );

    const [preserved] = await database.select().from(schema.accounts)
      .where(eq(schema.accounts.id, created.id));
    assert.equal(preserved.balance, 400);
    assert.equal(preserved.openingBalance, 400);
  });
});
