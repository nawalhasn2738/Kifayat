import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import {
  CategoryApplicabilityError,
  createTransactionRepository,
} from '../src/lib/repositories/transactions-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'local-category@example.test', name: 'Local Category User' },
      { id: otherUserId, email: 'other-category@example.test', name: 'Other Category User' },
    ]);
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local', type: 'checking', balance: 1_000 },
      { id: 2, userId: otherUserId, name: 'Other', type: 'checking', balance: 500 },
    ]);
    await database.insert(schema.categories).values([
      { id: 1, name: 'income_only' },
      { id: 2, name: 'expense_only' },
      { id: 3, name: 'legacy_unmapped' },
      { id: 4, name: 'both_types' },
      { id: 5, name: 'other_unmapped' },
    ]);
    await database.insert(schema.categoryApplicability).values([
      { categoryId: 1, transactionType: 'income' },
      { categoryId: 2, transactionType: 'expense' },
      { categoryId: 4, transactionType: 'income' },
      { categoryId: 4, transactionType: 'expense' },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await run({ sqlite, database, repository });
  } finally {
    sqlite.close();
  }
}

function input(overrides = {}) {
  return {
    date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    categoryId: null, accountId: 1, merchant: null, description: null,
    ...overrides,
  };
}

async function financialState(database) {
  return {
    accounts: await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)),
    transactions: await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)),
  };
}

test('category applicability repository: accepts valid, null, and explicit multi-type assignments', async () => {
  await withFixture(async ({ database, repository }) => {
    await repository.createTransaction(input({ categoryId: 1 }), { clientId: 'valid-income' });
    await repository.createTransaction(input({ categoryId: 2, type: 'expense' }), { clientId: 'valid-expense' });
    await repository.createTransaction(input(), { clientId: 'null-income' });
    await repository.createTransaction(input({ type: 'expense' }), { clientId: 'null-expense' });
    await repository.createTransaction(input({ categoryId: 4 }), { clientId: 'both-income' });
    await repository.createTransaction(input({ categoryId: 4, type: 'expense' }), { clientId: 'both-expense' });

    const rows = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((row) => [row.clientId, row.categoryId, row.type]), [
      ['valid-income', 1, 'income'], ['valid-expense', 2, 'expense'],
      ['null-income', null, 'income'], ['null-expense', null, 'expense'],
      ['both-income', 4, 'income'], ['both-expense', 4, 'expense'],
    ]);
  });
});

test('category applicability repository: returns distinct safe typed failures without writes', async () => {
  await withFixture(async ({ database, repository }) => {
    const before = await financialState(database);
    const cases = [
      { categoryId: 999, type: 'income', code: 'category_not_found' },
      { categoryId: 3, type: 'income', code: 'category_unmapped' },
      { categoryId: 2, type: 'income', code: 'category_incompatible' },
    ];

    for (const item of cases) {
      await assert.rejects(
        repository.createTransaction(input(item), { clientId: `rejected-${item.code}` }),
        (error) => {
          assert.ok(error instanceof CategoryApplicabilityError);
          assert.equal(error.code, item.code);
          assert.equal(error.categoryId, item.categoryId);
          assert.equal(error.transactionType, item.type);
          assert.doesNotMatch(error.message, /sqlite|constraint|query/i);
          return true;
        },
      );
      assert.deepEqual(await financialState(database), before);
    }
  });
});

test('category applicability repository: validates before create and update balance arithmetic', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.update(schema.accounts).set({ balance: Number.MAX_SAFE_INTEGER + 1 })
      .where(eq(schema.accounts.id, 1));
    const beforeCreate = await financialState(database);
    await assert.rejects(
      repository.createTransaction(input({ categoryId: 3 }), { clientId: 'before-create-arithmetic' }),
      (error) => error instanceof CategoryApplicabilityError && error.code === 'category_unmapped',
    );
    assert.deepEqual(await financialState(database), beforeCreate);

    await database.insert(schema.transactions).values({
      id: 20, clientId: 'before-update-arithmetic', userId: localUserId, accountId: 1,
      categoryId: 1, date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });
    const beforeUpdate = await financialState(database);
    await assert.rejects(
      repository.updateTransaction(20, input({ categoryId: 3, amount: 200 })),
      (error) => error instanceof CategoryApplicabilityError && error.code === 'category_unmapped',
    );
    assert.deepEqual(await financialState(database), beforeUpdate);
  });
});

test('category applicability repository: preserves an exact legacy assignment but rejects reassignment', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.update(schema.accounts).set({ balance: 1_100 }).where(eq(schema.accounts.id, 1));
    await database.insert(schema.transactions).values({
      id: 30, clientId: 'legacy-unmapped-update', userId: localUserId, accountId: 1,
      categoryId: 3, date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });

    const updated = await repository.updateTransaction(30, input({ categoryId: 3, amount: 200, merchant: 'Updated' }));
    assert.equal(updated?.category?.id, 3);
    assert.equal(updated?.amount, 200);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_200);

    const beforeRejected = await financialState(database);
    await assert.rejects(
      repository.updateTransaction(30, input({ categoryId: 5, amount: 250 })),
      (error) => error instanceof CategoryApplicabilityError && error.code === 'category_unmapped',
    );
    assert.deepEqual(await financialState(database), beforeRejected);
  });
});

test('category applicability repository: rejects a type change incompatible with the retained category', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.update(schema.accounts).set({ balance: 1_100 }).where(eq(schema.accounts.id, 1));
    await database.insert(schema.transactions).values({
      id: 40, clientId: 'type-change-category', userId: localUserId, accountId: 1,
      categoryId: 1, date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });
    const before = await financialState(database);

    await assert.rejects(
      repository.updateTransaction(40, input({ categoryId: 1, type: 'expense' })),
      (error) => error instanceof CategoryApplicabilityError && error.code === 'category_incompatible',
    );
    assert.deepEqual(await financialState(database), before);
  });
});

test('category applicability repository: identical replay precedes validation and remains idempotent', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.update(schema.accounts).set({ balance: 1_100 }).where(eq(schema.accounts.id, 1));
    await database.insert(schema.transactions).values({
      id: 50, clientId: 'legacy-replay', userId: localUserId, accountId: 1,
      categoryId: 3, date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });
    const before = await financialState(database);

    const replay = await repository.createTransaction(input({ categoryId: 3 }), { clientId: 'legacy-replay' });
    assert.equal(replay.id, 50);
    assert.deepEqual(await financialState(database), before);
  });
});

test('category applicability repository: historical unmapped and incompatible assignments remain readable', async () => {
  await withFixture(async ({ database, repository }) => {
    await database.insert(schema.transactions).values([
      { id: 60, clientId: 'historical-unmapped', userId: localUserId, accountId: 1,
        categoryId: 3, date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income' },
      { id: 61, clientId: 'historical-incompatible', userId: localUserId, accountId: 1,
        categoryId: 2, date: '2026-01-16T12:00:00.000Z', amount: 100, type: 'income' },
    ]);

    assert.deepEqual((await repository.listAllTransactions()).map((row) => [row.id, row.category?.id]), [
      [61, 2], [60, 3],
    ]);
  });
});
