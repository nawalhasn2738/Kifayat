import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { MAX_PKR_AMOUNT, parsePkrAmount } from '../src/lib/validation/transaction.ts';

const migration = readFileSync(new URL('../drizzle/0000_unknown_karma.sql', import.meta.url), 'utf8');
const statementBreakpoint = '--> statement-breakpoint';
const localUserId = 101;
const otherUserId = 202;

function applyMigration(sqlite) {
  for (const statement of migration.split(statementBreakpoint)) {
    if (statement.trim()) sqlite.exec(statement);
  }
}

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
    applyMigration(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: localUserId, email: 'local@example.test', name: 'Local User' },
      { id: otherUserId, email: 'other@example.test', name: 'Other User' },
    ]);
    await run({ sqlite, database });
  } finally {
    sqlite.close();
  }
}

function transactionInput(overrides = {}) {
  return {
    date: '2026-01-15T12:00:00.000Z', amount: 250, type: 'income',
    categoryId: null, accountId: 1, merchant: null, description: null,
    ...overrides,
  };
}

test('catalog integration: scopes and orders accounts, orders categories, and loads the configured profile', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Wallet', type: 'cash', balance: 50 },
      { id: 2, userId: localUserId, name: 'Bank', type: 'checking', balance: 100 },
      { id: 3, userId: otherUserId, name: 'Other Account', type: 'savings', balance: 999 },
    ]);
    await database.insert(schema.categories).values([
      { id: 1, name: 'Utilities' }, { id: 2, name: 'Food' }, { id: 3, name: 'Books' },
    ]);
    await database.insert(schema.userProfiles).values({
      userId: localUserId, monthlyIncome: 5000, emergencyFundTarget: 15000,
      riskTolerance: 'medium', dependents: 1, notesAboutSelf: 'Synthetic profile',
    });

    const repository = createCatalogRepository(database, { userId: localUserId });
    assert.deepEqual((await repository.listAccounts()).map((row) => row.name), ['Bank', 'Wallet']);
    assert.deepEqual((await repository.listCategories()).map((row) => row.name), ['Books', 'Food', 'Utilities']);
    const profile = await repository.getProfile();
    assert.equal(profile.userId, localUserId);
    assert.equal(profile.notesAboutSelf, 'Synthetic profile');

    const missing = createCatalogRepository(database, { userId: 303 });
    await assert.rejects(missing.getProfile(), /Local profile is unavailable/);
  });
});

test('catalog integration: reconciles signed effects read-only and remains user scoped', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Matched', type: 'checking', balance: 50 },
      { id: 2, userId: localUserId, name: 'Opening Candidate', type: 'savings', balance: 500 },
      { id: 3, userId: localUserId, name: 'Deliberate Mismatch', type: 'cash', balance: 90 },
      { id: 4, userId: localUserId, name: 'No Activity', type: 'cash', balance: 0 },
      { id: 5, userId: otherUserId, name: 'Private Other User', type: 'checking', balance: 999 },
    ]);
    await database.insert(schema.transactions).values([
      { clientId: 'matched-income', userId: localUserId, accountId: 1, date: '2026-01-01T00:00:00.000Z', amount: 100, type: 'income' },
      { clientId: 'matched-expense', userId: localUserId, accountId: 1, date: '2026-01-02T00:00:00.000Z', amount: -50, type: 'expense' },
      { clientId: 'opening-income', userId: localUserId, accountId: 2, date: '2026-01-03T00:00:00.000Z', amount: 200, type: 'income' },
      { clientId: 'mismatch-income', userId: localUserId, accountId: 3, date: '2026-01-04T00:00:00.000Z', amount: 100, type: 'income' },
      { clientId: 'private-income', userId: otherUserId, accountId: 5, date: '2026-01-05T00:00:00.000Z', amount: 999, type: 'income' },
    ]);
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const rows = await createCatalogRepository(database, { userId: localUserId }).reconcileAccountBalances();

    assert.deepEqual(rows, [
      { accountId: 3, accountName: 'Deliberate Mismatch', storedBalance: 90, transactionEffectTotal: 100, candidateOpeningBalance: -10, status: 'discrepancy' },
      { accountId: 1, accountName: 'Matched', storedBalance: 50, transactionEffectTotal: 50, candidateOpeningBalance: 0, status: 'matched' },
      { accountId: 4, accountName: 'No Activity', storedBalance: 0, transactionEffectTotal: 0, candidateOpeningBalance: 0, status: 'matched' },
      { accountId: 2, accountName: 'Opening Candidate', storedBalance: 500, transactionEffectTotal: 200, candidateOpeningBalance: 300, status: 'discrepancy' },
    ]);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: lists only the configured user in descending date order', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local', type: 'checking' },
      { id: 2, userId: otherUserId, name: 'Other', type: 'checking' },
    ]);
    await database.insert(schema.transactions).values([
      { clientId: 'local-old', userId: localUserId, accountId: 1, date: '2026-01-01T00:00:00.000Z', amount: 100, type: 'income' },
      { clientId: 'local-new', userId: localUserId, accountId: 1, date: '2026-02-01T00:00:00.000Z', amount: -20, type: 'expense' },
      { clientId: 'other', userId: otherUserId, accountId: 2, date: '2026-03-01T00:00:00.000Z', amount: 999, type: 'income' },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    assert.deepEqual((await repository.listTransactions()).map((row) => row.clientId), ['local-new', 'local-old']);
  });
});

test('transaction integration: create, update, and delete apply each balance effect exactly once', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1000 },
      { id: 2, userId: localUserId, name: 'Secondary', type: 'savings', balance: 500 },
    ]);
    let nextId = 0;
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => `client-${++nextId}`,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const income = await repository.createTransaction(transactionInput({ amount: 250 }));
    assert.equal(income.amount, 250);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1250);

    const expense = await repository.createTransaction(transactionInput({ amount: 100, type: 'expense' }));
    assert.equal(expense.amount, -100);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1150);

    const updated = await repository.updateTransaction(expense.id, transactionInput({ accountId: 2, amount: 40, type: 'expense' }));
    assert.equal(updated?.amount, -40);
    const balancesAfterUpdate = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    assert.deepEqual(balancesAfterUpdate.map((row) => row.balance), [1250, 460]);

    await repository.deleteTransaction(income.id);
    assert.equal(await repository.getTransaction(income.id), null);
    const balancesAfterDelete = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    assert.deepEqual(balancesAfterDelete.map((row) => row.balance), [1000, 460]);
  });
});

test('transaction integration: rejects another user account without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local', type: 'checking', balance: 100 },
      { id: 2, userId: otherUserId, name: 'Other', type: 'checking', balance: 900 },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'rejected-client', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await assert.rejects(repository.createTransaction(transactionInput({ accountId: 2 })), /selected account no longer exists/i);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.deepEqual((await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id))).map((row) => row.balance), [100, 900]);
  });
});

test('transaction integration: invalid raw PKR input cannot mutate rows or balances', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 700 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'must-not-be-used', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    for (const raw of ['125.75', String(MAX_PKR_AMOUNT + 1)]) {
      await assert.rejects(async () => repository.createTransaction(transactionInput({ amount: parsePkrAmount(raw) })), /positive whole amount/);
    }
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 700);
  });
});

test('transaction integration: invalid dates cannot create or update rows or balances', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 700 });
    await database.insert(schema.transactions).values({
      id: 55, clientId: 'date-original', userId: localUserId, accountId: 1,
      date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'invalid-date-client', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    await assert.rejects(repository.createTransaction(transactionInput({ date: '2026-02-30T00:00:00.000Z' })), /valid date/i);
    await assert.rejects(repository.updateTransaction(55, transactionInput({ date: '2025-02-29T00:00:00.000Z' })), /valid date/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
test('transaction integration: derives signs and reverses effects across both type changes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1000 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'type-change-client', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const expense = await repository.createTransaction(transactionInput({ amount: 100, type: 'expense' }));
    assert.equal(expense.amount, -100);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 900);

    const income = await repository.updateTransaction(expense.id, transactionInput({ amount: 250, type: 'income' }));
    assert.equal(income?.amount, 250);
    assert.equal(income?.type, 'income');
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1250);

    const expenseAgain = await repository.updateTransaction(expense.id, transactionInput({ amount: 40, type: 'expense' }));
    assert.equal(expenseAgain?.amount, -40);
    assert.equal(expenseAgain?.type, 'expense');
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 960);
  });
});

test('transaction integration: rejects signed and unsupported-type mutations without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1100 });
    await database.insert(schema.transactions).values({
      id: 56, clientId: 'type-original', userId: localUserId, accountId: 1,
      date: '2026-01-15T12:00:00.000Z', amount: 100, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'rejected-type-client', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    for (const input of [
      transactionInput({ amount: -125, type: 'income' }),
      transactionInput({ amount: -125, type: 'expense' }),
      transactionInput({ amount: 125, type: 'transfer' }),
    ]) {
      const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
      const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
      await assert.rejects(repository.createTransaction(input));
      await assert.rejects(repository.updateTransaction(56, input));
      assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
      assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
    }
  });
});
test('transaction integration: requires exact confirmation only when create would overdraw', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 300 });
    let nextId = 0;
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => `overdraft-create-${++nextId}`, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const withinBalance = await repository.createTransaction(transactionInput({ amount: 200, type: 'expense' }));
    assert.equal(withinBalance.amount, -200);
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.createTransaction(transactionInput({ amount: 150, type: 'expense' })), (error) => {
      assert.equal(error.name, 'OverdraftConfirmationRequiredError');
      assert.equal(error.accountId, 1);
      assert.equal(error.accountName, 'Primary');
      assert.equal(error.projectedBalance, -50);
      return true;
    });
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);

    await assert.rejects(repository.createTransaction(
      transactionInput({ amount: 150, type: 'expense' }),
      { overdraftConfirmation: { accountId: 1, projectedBalance: -40 } },
    ), (error) => {
      assert.equal(error.name, 'OverdraftConfirmationRequiredError');
      assert.equal(error.projectedBalance, -50);
      return true;
    });
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);

    const confirmed = await repository.createTransaction(
      transactionInput({ amount: 150, type: 'expense' }),
      { overdraftConfirmation: { accountId: 1, projectedBalance: -50 } },
    );
    assert.equal(confirmed.amount, -150);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, -50);
  });
});

test('transaction integration: rejects an unconfirmed same-account update overdraft without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 100 });
    await database.insert(schema.transactions).values({
      id: 57, clientId: 'overdraft-update-original', userId: localUserId, accountId: 1,
      date: '2026-01-15T12:00:00.000Z', amount: -50, type: 'expense',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    await assert.rejects(repository.updateTransaction(57, transactionInput({ amount: 200, type: 'expense' })), (error) => {
      assert.equal(error.name, 'OverdraftConfirmationRequiredError');
      assert.equal(error.projectedBalance, -50);
      return true;
    });
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: moving an expense checks the replacement account and applies both effects after confirmation', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Original', type: 'checking', balance: 900 },
      { id: 2, userId: localUserId, name: 'Replacement', type: 'savings', balance: 200 },
    ]);
    await database.insert(schema.transactions).values({
      id: 58, clientId: 'overdraft-move-original', userId: localUserId, accountId: 1,
      date: '2026-01-15T12:00:00.000Z', amount: -100, type: 'expense',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const replacement = transactionInput({ accountId: 2, amount: 250, type: 'expense' });

    await assert.rejects(repository.updateTransaction(58, replacement), (error) => {
      assert.equal(error.name, 'OverdraftConfirmationRequiredError');
      assert.equal(error.accountId, 2);
      assert.equal(error.accountName, 'Replacement');
      assert.equal(error.projectedBalance, -50);
      return true;
    });
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);

    const moved = await repository.updateTransaction(58, replacement, {
      overdraftConfirmation: { accountId: 2, projectedBalance: -50 },
    });
    assert.equal(moved?.account.id, 2);
    assert.equal(moved?.amount, -250);
    assert.deepEqual((await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id))).map((row) => row.balance), [1000, -50]);
  });
});
test('transaction integration: rejects updating a legacy transfer without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Legacy Transfer Account', type: 'checking', balance: 900 },
      { id: 2, userId: localUserId, name: 'Unaffected Account', type: 'savings', balance: 500 },
    ]);
    // Direct insertion represents a legacy row that the canonical mutation validator cannot create.
    await database.insert(schema.transactions).values({
      id: 68,
      clientId: 'legacy-transfer-update',
      userId: localUserId,
      accountId: 1,
      date: '2026-04-01T00:00:00.000Z',
      amount: -100,
      type: 'transfer',
      merchant: 'Legacy transfer',
      description: 'Unsupported single-account transfer fixture',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-02T00:00:00.000Z'),
    });

    await assert.rejects(
      repository.updateTransaction(68, transactionInput({ accountId: 2, amount: 50, type: 'income' })),
      /legacy transfers cannot be updated or deleted until transfer support exists/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: rejects deleting a legacy transfer without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Legacy Transfer Account', type: 'checking', balance: 900 },
      { id: 2, userId: localUserId, name: 'Unaffected Account', type: 'savings', balance: 500 },
    ]);
    // Direct insertion represents a legacy row that the canonical mutation validator cannot create.
    await database.insert(schema.transactions).values({
      id: 69,
      clientId: 'legacy-transfer-delete',
      userId: localUserId,
      accountId: 1,
      date: '2026-04-01T00:00:00.000Z',
      amount: -100,
      type: 'transfer',
      merchant: 'Legacy transfer',
      description: 'Unsupported single-account transfer fixture',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-02T00:00:00.000Z'),
    });

    await assert.rejects(
      repository.deleteTransaction(69),
      /legacy transfers cannot be updated or deleted until transfer support exists/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
test('transaction integration: update rejects an inconsistent existing account owner without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local Account', type: 'checking', balance: 400 },
      { id: 2, userId: otherUserId, name: 'Other Account', type: 'checking', balance: 800 },
    ]);
    await database.insert(schema.transactions).values({
      id: 66,
      clientId: 'inconsistent-update',
      userId: localUserId,
      accountId: 2,
      date: '2026-04-01T00:00:00.000Z',
      amount: -200,
      type: 'expense',
      merchant: 'Original Merchant',
      description: 'Inconsistent owner fixture',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-02T00:00:00.000Z'),
    });

    await assert.rejects(
      repository.updateTransaction(66, transactionInput({ accountId: 1, amount: 50, type: 'income' })),
      /Transaction account ownership is inconsistent/,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: delete rejects an inconsistent existing account owner without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local Account', type: 'checking', balance: 400 },
      { id: 2, userId: otherUserId, name: 'Other Account', type: 'checking', balance: 800 },
    ]);
    await database.insert(schema.transactions).values({
      id: 67,
      clientId: 'inconsistent-delete',
      userId: localUserId,
      accountId: 2,
      date: '2026-04-01T00:00:00.000Z',
      amount: -200,
      type: 'expense',
      merchant: 'Original Merchant',
      description: 'Inconsistent owner fixture',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'unused', now: () => new Date('2026-04-02T00:00:00.000Z'),
    });

    await assert.rejects(repository.deleteTransaction(67), /Transaction account ownership is inconsistent/);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
 });

test('transaction integration: rolls back an update after reversing the old account effect', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Original Account', type: 'checking', balance: 900 },
      { id: 2, userId: localUserId, name: 'Replacement Account', type: 'savings', balance: 500 },
    ]);
    await database.insert(schema.transactions).values({
      id: 77,
      clientId: 'update-rollback-original',
      userId: localUserId,
      accountId: 1,
      categoryId: null,
      date: '2026-01-10T00:00:00.000Z',
      amount: -100,
      type: 'expense',
      merchant: 'Original Merchant',
      description: 'Original description',
      isAnomaly: true,
      createdAt: '2026-01-10T01:00:00.000Z',
      updatedAt: '2026-01-10T01:00:00.000Z',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    sqlite.exec("CREATE TRIGGER abort_transaction_replacement BEFORE UPDATE ON transactions WHEN OLD.id = 77 BEGIN SELECT RAISE(ABORT, 'synthetic transaction update failure'); END");
    const repository = createTransactionRepository(database, {
      userId: localUserId,
      createClientId: () => 'unused-for-update',
      now: () => new Date('2026-02-20T00:00:00.000Z'),
    });

    await assert.rejects(
      repository.updateTransaction(77, transactionInput({
        accountId: 2,
        amount: 250,
        type: 'expense',
        date: '2026-02-15T00:00:00.000Z',
        merchant: 'Replacement Merchant',
        description: 'Replacement description',
      })),
      /synthetic transaction update failure/,
    );

    const accountsAfter = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsAfter = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    assert.deepEqual(accountsAfter, accountsBefore);
    assert.deepEqual(transactionsAfter, transactionsBefore);
    assert.equal(transactionsAfter.length, 1);
    assert.deepEqual(transactionsAfter[0], transactionsBefore[0]);
    assert.equal(transactionsAfter.some((row) => row.accountId === 2 || row.amount === -250), false);
  });
});

test('transaction integration: rolls back deletion when balance reversal aborts', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.accounts).values({
      id: 1,
      userId: localUserId,
      name: 'Deletion Account',
      type: 'checking',
      balance: 900,
    });
    await database.insert(schema.transactions).values({
      id: 88,
      clientId: 'delete-rollback-original',
      userId: localUserId,
      accountId: 1,
      categoryId: null,
      date: '2026-03-10T00:00:00.000Z',
      amount: -100,
      type: 'expense',
      merchant: 'Deletion Merchant',
      description: 'Must survive rollback',
      isAnomaly: true,
      createdAt: '2026-03-10T01:00:00.000Z',
      updatedAt: '2026-03-10T01:00:00.000Z',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    sqlite.exec("CREATE TRIGGER abort_delete_balance_reversal BEFORE UPDATE OF balance ON accounts WHEN OLD.id = 1 BEGIN SELECT RAISE(ABORT, 'synthetic delete balance failure'); END");
    const repository = createTransactionRepository(database, {
      userId: localUserId,
      createClientId: () => 'unused-for-delete',
      now: () => new Date('2026-03-20T00:00:00.000Z'),
    });

    await assert.rejects(repository.deleteTransaction(88), /Failed to run the query/);

    const accountsAfter = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsAfter = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    assert.deepEqual(accountsAfter, accountsBefore);
    assert.deepEqual(transactionsAfter, transactionsBefore);
    assert.equal(accountsAfter[0].balance, 900);
    assert.equal(transactionsAfter.length, 1);
    assert.deepEqual(transactionsAfter[0], transactionsBefore[0]);
  });
});

test('transaction integration: rolls back the inserted transaction when the balance update aborts', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 700 });
    sqlite.exec("CREATE TRIGGER abort_balance_update BEFORE UPDATE OF balance ON accounts BEGIN SELECT RAISE(ABORT, 'synthetic balance failure'); END");
    const repository = createTransactionRepository(database, {
      userId: localUserId, createClientId: () => 'rollback-client', now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await assert.rejects(repository.createTransaction(transactionInput({ amount: 300 })), /Failed to run the query/);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 700);
  });
});
