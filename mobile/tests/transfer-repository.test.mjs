import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createTransferRepository } from '../src/lib/repositories/transfers-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const input = (overrides = {}) => ({ date: '2026-10-20T12:00:00.000Z', amount: 250,
  sourceAccountId: 1, destinationAccountId: 2, description: null, ...overrides });
async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.users).values([
      { id: 101, email: 'local@test.dev', name: 'Local' }, { id: 202, email: 'other@test.dev', name: 'Other' },
    ]);
    await db.insert(schema.accounts).values([
      { id: 1, userId: 101, name: 'Source', type: 'checking', balance: 1000 },
      { id: 2, userId: 101, name: 'Destination', type: 'savings', balance: 100 },
      { id: 3, userId: 202, name: 'Private', type: 'cash', balance: 500 },
    ]);
    const repository = createTransferRepository(db, { userId: 101, now: () => new Date('2026-10-21T12:00:00.000Z') });
    await run({ sqlite, db, repository });
  } finally { sqlite.close(); }
}
const balances = (sqlite) => sqlite.prepare('SELECT id, balance FROM accounts ORDER BY id').all();

test('transfer creation is balanced and idempotent', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const first = await repository.createTransfer(input(), 'request-1');
    assert.equal((await repository.createTransfer(input(), 'request-1')).id, first.id);
    assert.deepEqual(balances(sqlite), [
      { id: 1, balance: 750 }, { id: 2, balance: 350 }, { id: 3, balance: 500 },
    ]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM transfers').get().count, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM transactions').get().count, 0);
    await assert.rejects(repository.createTransfer(input({ amount: 251 }), 'request-1'), /different details/i);
  });
});

test('invalid transfers make no writes', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const before = balances(sqlite);
    for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      await assert.rejects(repository.createTransfer(input({ amount }), 'bad-' + String(amount)));
    }
    await assert.rejects(repository.createTransfer(input({ destinationAccountId: 1 }), 'same'), /different accounts/i);
    await assert.rejects(repository.createTransfer(input({ destinationAccountId: 3 }), 'private'), /does not exist/i);
    await assert.rejects(repository.createTransfer(input({ amount: 1001 }), 'overdraft'), /insufficient funds/i);
    await assert.rejects(repository.createTransfer(input({ date: '2026-10-22T12:00:00.000Z' }), 'future'), /future-dated/i);
    assert.deepEqual(balances(sqlite), before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM transfers').get().count, 0);
  });
});

test('transfer correction recalculates effects and deletion reverses both', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const created = await repository.createTransfer(input(), 'change');
    const updated = await repository.updateTransfer(created.id, input({ amount: 400 }));
    assert.equal(updated.amount, 400);
    assert.deepEqual(balances(sqlite).slice(0, 2), [{ id: 1, balance: 600 }, { id: 2, balance: 500 }]);
    await repository.deleteTransfer(created.id);
    assert.deepEqual(balances(sqlite).slice(0, 2), [{ id: 1, balance: 1000 }, { id: 2, balance: 100 }]);
    assert.equal(await repository.getTransfer(created.id), null);
  });
});

test('failed transfer rolls back its row and both balance effects', async () => {
  await fixture(async ({ sqlite, repository }) => {
    sqlite.exec('CREATE TRIGGER fail_transfer_balance BEFORE UPDATE ON accounts WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, \'synthetic transfer failure\'); END;');
    const before = balances(sqlite);
    await assert.rejects(repository.createTransfer(input(), 'rollback'), /synthetic transfer failure/i);
    assert.deepEqual(balances(sqlite), before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM transfers').get().count, 0);
  });
});

test('failed correction and deletion preserve the original transfer and balances', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const created = await repository.createTransfer(input(), 'protected');
    const before = balances(sqlite);
    sqlite.exec('CREATE TRIGGER fail_transfer_mutation BEFORE UPDATE ON accounts WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, \'synthetic mutation failure\'); END;');
    await assert.rejects(repository.updateTransfer(created.id, input({ amount: 300 })), /synthetic mutation failure/i);
    await assert.rejects(repository.deleteTransfer(created.id), /synthetic mutation failure/i);
    assert.deepEqual(balances(sqlite), before);
    assert.equal((await repository.getTransfer(created.id)).amount, 250);
  });
});

test('overdrawing correction is rejected before any account write', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const created = await repository.createTransfer(input(), 'overdraw-update');
    const beforeBalances = balances(sqlite);
    const beforeTransfer = sqlite.prepare('SELECT * FROM transfers WHERE id = ?').get(created.id);
    sqlite.exec('CREATE TRIGGER reject_any_account_update BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, \'account update attempted\'); END;');
    await assert.rejects(repository.updateTransfer(created.id, input({ sourceAccountId: 2, destinationAccountId: 1, amount: 400 })), /insufficient funds/i);
    assert.deepEqual(balances(sqlite), beforeBalances);
    assert.deepEqual(sqlite.prepare('SELECT * FROM transfers WHERE id = ?').get(created.id), beforeTransfer);
  });
});

test('persisted transfer reads fail closed for malformed data', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const statement = 'INSERT INTO transfers (client_id, user_id, source_account_id, destination_account_id, amount, date) VALUES (?, ?, ?, ?, ?, ?)';
    const result = sqlite.prepare(statement).run('', 101, 1, 2, 25, 'not-a-date');
    await assert.rejects(repository.getTransfer(Number(result.lastInsertRowid)), /invalid persisted transfer/i);
    await assert.rejects(repository.listTransfers(), /invalid persisted transfer/i);
  });
});

test('persisted transfer reads reject cross-user account relationships without exposing metadata', async () => {
  await fixture(async ({ sqlite, repository }) => {
    const statement = 'INSERT INTO transfers (client_id, user_id, source_account_id, destination_account_id, amount, date) VALUES (?, ?, ?, ?, ?, ?)';
    const result = sqlite.prepare(statement).run('cross-owner', 101, 1, 3, 25, '2026-10-20T12:00:00.000Z');
    const id = Number(result.lastInsertRowid);
    await assert.rejects(repository.getTransfer(id), (error) => {
      assert.match(error.message, /invalid persisted transfer/i);
      assert.doesNotMatch(error.message, /private/i);
      return true;
    });
    await assert.rejects(repository.listTransfers(), /invalid persisted transfer/i);
  });
});

test('cross-user get, update, and delete by transfer id fail safely', async () => {
  await fixture(async ({ sqlite, db, repository }) => {
    const created = await repository.createTransfer(input(), 'owned-transfer');
    const beforeBalances = balances(sqlite);
    const foreignRepository = createTransferRepository(db, {
      userId: 202, now: () => new Date('2026-10-21T12:00:00.000Z'),
    });
    assert.equal(await foreignRepository.getTransfer(created.id), null);
    await assert.rejects(foreignRepository.updateTransfer(created.id, input()), /transfer not found/i);
    await assert.rejects(foreignRepository.deleteTransfer(created.id), /transfer not found/i);
    assert.deepEqual(balances(sqlite), beforeBalances);
    assert.equal((await repository.getTransfer(created.id)).id, created.id);
  });
});
