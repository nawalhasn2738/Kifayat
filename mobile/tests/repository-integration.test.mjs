import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { calculateAffordability, createSummaryService } from '../src/lib/services/finance-core.ts';
import { MAX_PKR_AMOUNT, parsePkrAmount } from '../src/lib/validation/transaction.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const localUserId = 101;
const otherUserId = 202;

async function withFixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
    await migrateWithExpoPath(sqlite);
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

let nextRequestId = 0;
function creationOptions(overrides = {}) {
  return { clientId: `test-request-${++nextRequestId}`, ...overrides };
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

test('catalog integration: rejects unsafe stored balances and transaction effects without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Unsafe Balance', type: 'checking', balance: Number.MAX_SAFE_INTEGER + 1,
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      createCatalogRepository(database, { userId: localUserId }).reconcileAccountBalances(),
      /safe integer monetary values/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });

  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Unsafe Effect', type: 'checking', balance: 0,
    });
    await database.insert(schema.transactions).values({
      clientId: 'unsafe-reconciliation-effect', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: Number.MAX_SAFE_INTEGER + 1, type: 'income',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      createCatalogRepository(database, { userId: localUserId }).reconcileAccountBalances(),
      /safe integer monetary values/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('catalog integration: rejects an unsafe aggregate of individually safe effects without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Aggregate Overflow', type: 'checking', balance: 0,
    });
    await database.insert(schema.transactions).values([
      { clientId: 'aggregate-safe-maximum', userId: localUserId, accountId: 1, date: '2026-01-01T00:00:00.000Z', amount: Number.MAX_SAFE_INTEGER, type: 'transfer' },
      { clientId: 'aggregate-overflow-one', userId: localUserId, accountId: 1, date: '2026-01-02T00:00:00.000Z', amount: 1, type: 'transfer' },
    ]);
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      createCatalogRepository(database, { userId: localUserId }).reconcileAccountBalances(),
      /safe integer monetary values/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('catalog integration: rejects an unsafe candidate opening-balance difference without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Candidate Underflow', type: 'checking', balance: Number.MIN_SAFE_INTEGER,
    });
    await database.insert(schema.transactions).values({
      clientId: 'candidate-underflow-effect', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 1, type: 'income',
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      createCatalogRepository(database, { userId: localUserId }).reconcileAccountBalances(),
      /safe integer monetary values/i,
    );
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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    assert.deepEqual((await repository.listTransactions()).map((row) => row.clientId), ['local-new', 'local-old']);
  });
});

test('transaction integration: complete reporting retrieval exceeds 5,000 rows without omissions or cross-user data', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local', type: 'checking', balance: 0 },
      { id: 2, userId: otherUserId, name: 'Other', type: 'checking', balance: 0 },
    ]);
    const localRows = Array.from({ length: 5_001 }, (_, index) => ({
      clientId: `complete-history-${String(index).padStart(4, '0')}`,
      userId: localUserId,
      accountId: 1,
      date: '2026-01-01T00:00:00.000Z',
      amount: 1,
      type: 'income',
    }));
    for (let offset = 0; offset < localRows.length; offset += 250) {
      await database.insert(schema.transactions).values(localRows.slice(offset, offset + 250));
    }
    await database.insert(schema.transactions).values({
      clientId: 'other-user-history', userId: otherUserId, accountId: 2,
      date: '2026-12-31T00:00:00.000Z', amount: 999, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    assert.equal((await repository.listTransactions(5_000)).length, 5_000);
    const complete = await repository.listAllTransactions();
    assert.equal(complete.length, 5_001);
    assert.equal(new Set(complete.map((row) => row.id)).size, 5_001);
    assert.equal(complete[0].clientId, 'complete-history-5000');
    assert.equal(complete.at(-1)?.clientId, 'complete-history-0000');
    assert.equal(complete.some((row) => row.clientId === 'other-user-history'), false);
  });
});
test('transaction integration: create, update, and delete apply each balance effect exactly once', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1000 },
      { id: 2, userId: localUserId, name: 'Secondary', type: 'savings', balance: 500 },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const income = await repository.createTransaction(transactionInput({ amount: 250 }), creationOptions());
    assert.equal(income.amount, 250);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1250);

    const expense = await repository.createTransaction(transactionInput({ amount: 100, type: 'expense' }), creationOptions());
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

test('transaction integration: replays identical creation and rejects conflicting or cross-user reuse', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local Primary', type: 'checking', balance: 100 },
      { id: 2, userId: localUserId, name: 'Local Secondary', type: 'savings', balance: 500 },
      { id: 3, userId: otherUserId, name: 'Other Primary', type: 'checking', balance: 900 },
    ]);
    const localRepository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const request = transactionInput({ amount: 250, merchant: '  Employer  ', description: '  April pay  ' });
    const options = { clientId: 'stable-create-request' };

    const created = await localRepository.createTransaction(request, options);
    const replayed = await localRepository.createTransaction(
      transactionInput({ amount: 250, merchant: 'Employer', description: 'April pay' }),
      options,
    );
    assert.equal(replayed.id, created.id);
    assert.equal(replayed.clientId, options.clientId);
    assert.equal((await database.select().from(schema.transactions)).length, 1);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 350);

    const accountsBeforeConflicts = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBeforeConflicts = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    await assert.rejects(
      localRepository.createTransaction(transactionInput({ amount: 251, merchant: 'Employer', description: 'April pay' }), options),
      /request ID was already used for different transaction details/i,
    );
    await assert.rejects(
      localRepository.createTransaction(transactionInput({ accountId: 2, amount: 250, merchant: 'Employer', description: 'April pay' }), options),
      /request ID was already used for different transaction details/i,
    );

    const otherRepository = createTransactionRepository(database, {
      userId: otherUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await assert.rejects(
      otherRepository.createTransaction(transactionInput({ accountId: 3, amount: 250, merchant: 'Employer', description: 'April pay' }), options),
      /request ID was already used for different transaction details/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBeforeConflicts);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBeforeConflicts);
  });
});

test('transaction integration: rolled-back creation can retry with the same request ID', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 700 });
    sqlite.exec("CREATE TRIGGER abort_idempotent_balance BEFORE UPDATE OF balance ON accounts BEGIN SELECT RAISE(ABORT, 'synthetic idempotent failure'); END");
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const options = { clientId: 'retry-after-rollback' };
    const input = transactionInput({ amount: 300 });

    await assert.rejects(repository.createTransaction(input, options), /Failed to run the query/);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 700);

    sqlite.exec('DROP TRIGGER abort_idempotent_balance');
    const created = await repository.createTransaction(input, options);
    assert.equal(created.clientId, options.clientId);
    assert.equal((await database.select().from(schema.transactions)).length, 1);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1000);
  });
});

test('transaction integration: overdraft replay returns the original row without a second effect', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 100 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const input = transactionInput({ amount: 150, type: 'expense' });
    const clientId = 'confirmed-overdraft-replay';

    await assert.rejects(
      repository.createTransaction(input, { clientId }),
      (error) => error.name === 'OverdraftConfirmationRequiredError' && error.projectedBalance === -50,
    );
    const created = await repository.createTransaction(input, {
      clientId,
      overdraftConfirmation: { accountId: 1, projectedBalance: -50 },
    });
    const replayed = await repository.createTransaction(input, { clientId });
    assert.equal(replayed.id, created.id);
    assert.equal((await database.select().from(schema.transactions)).length, 1);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, -50);
  });
});

test('transaction integration: same-ID calls initiated together produce one row and one balance effect', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 100 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const input = transactionInput({ amount: 75 });
    const options = { clientId: 'same-tick-duplicate' };

    const [first, second] = await Promise.all([
      repository.createTransaction(input, options),
      repository.createTransaction(input, options),
    ]);
    assert.equal(second.id, first.id);
    assert.equal((await database.select().from(schema.transactions)).length, 1);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 175);
  });
});
test('transaction integration: composed ledger mutations preserve zero-opening balance reconciliation', async () => {
  await withFixture(async ({ sqlite, database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Alpha', type: 'checking', balance: 0 },
      { id: 2, userId: localUserId, name: 'Beta', type: 'savings', balance: 0 },
      { id: 3, userId: otherUserId, name: 'Private', type: 'checking', balance: 900 },
    ]);
    const transactions = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const catalog = createCatalogRepository(database, { userId: localUserId });

    async function assertReconciliation(expectedAlpha, expectedBeta) {
      const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
      const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
      assert.deepEqual(accountsBefore.map(({ id, balance }) => ({ id, balance })), [
        { id: 1, balance: expectedAlpha },
        { id: 2, balance: expectedBeta },
        { id: 3, balance: 900 },
      ]);
      assert.deepEqual(await catalog.reconcileAccountBalances(), [
        { accountId: 1, accountName: 'Alpha', storedBalance: expectedAlpha, transactionEffectTotal: expectedAlpha, candidateOpeningBalance: 0, status: 'matched' },
        { accountId: 2, accountName: 'Beta', storedBalance: expectedBeta, transactionEffectTotal: expectedBeta, candidateOpeningBalance: 0, status: 'matched' },
      ]);
      assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
      assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
    }

    const alphaIncomeInput = transactionInput({ accountId: 1, amount: 1000, type: 'income' });
    const alphaIncome = await transactions.createTransaction(alphaIncomeInput, { clientId: 'composed-alpha-income' });
    const alphaExpense = await transactions.createTransaction(
      transactionInput({ accountId: 1, amount: 200, type: 'expense' }),
      { clientId: 'composed-alpha-expense' },
    );
    const betaIncome = await transactions.createTransaction(
      transactionInput({ accountId: 2, amount: 500, type: 'income' }),
      { clientId: 'composed-beta-income' },
    );
    await assertReconciliation(800, 500);

    await transactions.updateTransaction(alphaExpense.id, transactionInput({ accountId: 1, amount: 300, type: 'expense' }));
    await assertReconciliation(700, 500);

    await transactions.updateTransaction(
      betaIncome.id,
      transactionInput({ accountId: 2, amount: 100, type: 'expense' }),
      { overdraftConfirmation: { accountId: 2, projectedBalance: -100 } },
    );
    await assertReconciliation(700, -100);

    await transactions.updateTransaction(
      alphaExpense.id,
      transactionInput({ accountId: 2, amount: 300, type: 'expense' }),
      { overdraftConfirmation: { accountId: 2, projectedBalance: -400 } },
    );
    await assertReconciliation(1000, -400);

    const replayed = await transactions.createTransaction(alphaIncomeInput, { clientId: 'composed-alpha-income' });
    assert.equal(replayed.id, alphaIncome.id);
    await assertReconciliation(1000, -400);

    const accountsBeforeFailure = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBeforeFailure = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    sqlite.exec("CREATE TRIGGER abort_composed_balance BEFORE UPDATE OF balance ON accounts BEGIN SELECT RAISE(ABORT, 'synthetic composed failure'); END");
    await assert.rejects(
      transactions.createTransaction(transactionInput({ accountId: 1, amount: 50, type: 'income' }), { clientId: 'composed-failed-create' }),
      /Failed to run the query/,
    );
    sqlite.exec('DROP TRIGGER abort_composed_balance');
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBeforeFailure);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBeforeFailure);
    await assertReconciliation(1000, -400);

    await transactions.deleteTransaction(alphaIncome.id);
    await transactions.deleteTransaction(betaIncome.id);
    await assertReconciliation(0, -300);
    await transactions.deleteTransaction(alphaExpense.id);
    await assertReconciliation(0, 0);
  });
});
test('transaction integration: permits exact safe-integer balance boundaries and rejects overflow', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Upper', type: 'checking', balance: Number.MAX_SAFE_INTEGER - 1 },
      { id: 2, userId: localUserId, name: 'Lower', type: 'checking', balance: Number.MIN_SAFE_INTEGER + 1 },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    await repository.createTransaction(transactionInput({ accountId: 1, amount: 1, type: 'income' }), { clientId: 'upper-boundary' });
    await repository.createTransaction(
      transactionInput({ accountId: 2, amount: 1, type: 'expense' }),
      { clientId: 'lower-boundary', overdraftConfirmation: { accountId: 2, projectedBalance: Number.MIN_SAFE_INTEGER } },
    );
    assert.deepEqual(
      (await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id))).map((row) => row.balance),
      [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
    );

    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    await assert.rejects(
      repository.createTransaction(transactionInput({ accountId: 1, amount: 1, type: 'income' }), { clientId: 'upper-overflow' }),
      /safe integer/i,
    );
    await assert.rejects(
      repository.createTransaction(transactionInput({ accountId: 2, amount: 1, type: 'expense' }), { clientId: 'lower-overflow' }),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: rejects unsafe same-account update without mutation', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: Number.MAX_SAFE_INTEGER - 1,
    });
    await database.insert(schema.transactions).values({
      id: 90, clientId: 'unsafe-same-account-update', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 1, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.updateTransaction(90, transactionInput({ accountId: 1, amount: MAX_PKR_AMOUNT, type: 'income' })),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: rejects unsafe source or destination account movement without mutation', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Unsafe Source', type: 'checking', balance: Number.MAX_SAFE_INTEGER },
      { id: 2, userId: localUserId, name: 'Safe Destination', type: 'savings', balance: 0 },
    ]);
    await database.insert(schema.transactions).values({
      id: 91, clientId: 'unsafe-source-move', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: -1, type: 'expense',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.updateTransaction(
        91,
        transactionInput({ accountId: 2, amount: 1, type: 'expense' }),
        { overdraftConfirmation: { accountId: 2, projectedBalance: -1 } },
      ),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });

  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Safe Source', type: 'checking', balance: -1 },
      { id: 2, userId: localUserId, name: 'Unsafe Destination', type: 'savings', balance: Number.MAX_SAFE_INTEGER },
    ]);
    await database.insert(schema.transactions).values({
      id: 92, clientId: 'unsafe-destination-move', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: -1, type: 'expense',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.updateTransaction(92, transactionInput({ accountId: 2, amount: 1, type: 'income' })),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: rejects unsafe deletion reversal and unsafe stored values', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Deletion Boundary', type: 'checking', balance: Number.MAX_SAFE_INTEGER,
    });
    await database.insert(schema.transactions).values({
      id: 93, clientId: 'unsafe-delete-reversal', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: -1, type: 'expense',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.deleteTransaction(93), /safe integer/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });

  await withFixture(async ({ database }) => {
    const unsafeBalance = Number.MAX_SAFE_INTEGER + 1;
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Unsafe Stored Balance', type: 'checking', balance: unsafeBalance,
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.createTransaction(transactionInput({ accountId: 1, amount: 1, type: 'expense' }), { clientId: 'unsafe-stored-balance' }),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });

  await withFixture(async ({ database }) => {
    const unsafeEffect = Number.MAX_SAFE_INTEGER + 1;
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Unsafe Effect', type: 'checking', balance: 0 });
    await database.insert(schema.transactions).values({
      id: 94, clientId: 'unsafe-stored-effect', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: unsafeEffect, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.deleteTransaction(94), /safe integer/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
test('transaction integration: rejects an unsafe reversal even when the eventual same-account result would be safe', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Unsafe Intermediate', type: 'checking', balance: Number.MAX_SAFE_INTEGER,
    });
    await database.insert(schema.transactions).values({
      id: 95, clientId: 'unsafe-intermediate-safe-final', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: -1, type: 'expense',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.updateTransaction(95, transactionInput({ accountId: 1, amount: 1, type: 'expense' })),
      /safe integer/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: rejects a negative unsafe stored effect before subtraction or mutation', async () => {
  await withFixture(async ({ database }) => {
    const unsafeNegativeEffect = Number.MIN_SAFE_INTEGER - 1;
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Unsafe Negative Effect', type: 'checking', balance: 0,
    });
    await database.insert(schema.transactions).values({
      id: 96, clientId: 'unsafe-negative-stored-effect', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: unsafeNegativeEffect, type: 'expense',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.deleteTransaction(96), /safe integer/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: subtraction permits the lower safe boundary and rejects crossing below it', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Exact Lower Boundary', type: 'checking', balance: Number.MIN_SAFE_INTEGER + 1,
    });
    await database.insert(schema.transactions).values({
      id: 97, clientId: 'exact-lower-subtraction', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 1, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    await repository.deleteTransaction(97);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, Number.MIN_SAFE_INTEGER);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
  });

  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({
      id: 1, userId: localUserId, name: 'Below Lower Boundary', type: 'checking', balance: Number.MIN_SAFE_INTEGER,
    });
    await database.insert(schema.transactions).values({
      id: 98, clientId: 'below-lower-subtraction', userId: localUserId, accountId: 1,
      date: '2026-01-01T00:00:00.000Z', amount: 1, type: 'income',
    });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.deleteTransaction(98), /safe integer/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
test('transaction integration: rejects another user account without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values([
      { id: 1, userId: localUserId, name: 'Local', type: 'checking', balance: 100 },
      { id: 2, userId: otherUserId, name: 'Other', type: 'checking', balance: 900 },
    ]);
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await assert.rejects(repository.createTransaction(transactionInput({ accountId: 2 }), creationOptions()), /selected account no longer exists/i);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.deepEqual((await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id))).map((row) => row.balance), [100, 900]);
  });
});

test('transaction integration: invalid raw PKR input cannot mutate rows or balances', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 700 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    for (const raw of ['125.75', String(MAX_PKR_AMOUNT + 1)]) {
      await assert.rejects(async () => repository.createTransaction(transactionInput({ amount: parsePkrAmount(raw) }), creationOptions()), /positive whole amount/);
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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    await assert.rejects(repository.createTransaction(transactionInput({ date: '2026-02-30T00:00:00.000Z' }), creationOptions()), /valid date/i);
    await assert.rejects(repository.updateTransaction(55, transactionInput({ date: '2025-02-29T00:00:00.000Z' })), /valid date/i);
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
test('transaction integration: derives signs and reverses effects across both type changes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1000 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const expense = await repository.createTransaction(transactionInput({ amount: 100, type: 'expense' }), creationOptions());
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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    for (const input of [
      transactionInput({ amount: -125, type: 'income' }),
      transactionInput({ amount: -125, type: 'expense' }),
      transactionInput({ amount: 125, type: 'transfer' }),
    ]) {
      const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
      const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
      await assert.rejects(repository.createTransaction(input, creationOptions()));
      await assert.rejects(repository.updateTransaction(56, input));
      assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
      assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
    }
  });
});
test('transaction integration: requires exact confirmation only when create would overdraw', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 300 });
    const repository = createTransactionRepository(database, {
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    const withinBalance = await repository.createTransaction(transactionInput({ amount: 200, type: 'expense' }), creationOptions());
    assert.equal(withinBalance.amount, -200);
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(repository.createTransaction(transactionInput({ amount: 150, type: 'expense' }), creationOptions()), (error) => {
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
      creationOptions({ overdraftConfirmation: { accountId: 1, projectedBalance: -40 } }),
    ), (error) => {
      assert.equal(error.name, 'OverdraftConfirmationRequiredError');
      assert.equal(error.projectedBalance, -50);
      return true;
    });
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);

    const confirmed = await repository.createTransaction(
      transactionInput({ amount: 150, type: 'expense' }),
      creationOptions({ overdraftConfirmation: { accountId: 1, projectedBalance: -50 } }),
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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
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
      userId: localUserId, now: () => new Date('2026-04-02T00:00:00.000Z'),
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
      userId: localUserId, now: () => new Date('2026-04-02T00:00:00.000Z'),
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
      userId: localUserId, now: () => new Date('2026-04-02T00:00:00.000Z'),
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
      userId: localUserId, now: () => new Date('2026-04-02T00:00:00.000Z'),
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
      now: () => new Date('2026-03-20T00:00:00.000Z'),
    });

    await assert.rejects(repository.deleteTransaction(88), /synthetic delete balance failure/);

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
      userId: localUserId, now: () => new Date('2026-04-01T00:00:00.000Z'),
    });
    await assert.rejects(repository.createTransaction(transactionInput({ amount: 300 }), creationOptions({ clientId: 'rollback-client' })), /Failed to run the query/);
    assert.equal((await database.select().from(schema.transactions)).length, 0);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 700);
  });
});

test('transaction integration: rejects future income and expense creation before any balance or reporting change', async () => {
  await withFixture(async ({ database }) => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1_000 });
    const repository = createTransactionRepository(database, { userId: localUserId, now: () => now });
    const catalog = createCatalogRepository(database, { userId: localUserId });
    const getSummary = createSummaryService({
      listAccounts: catalog.listAccounts,
      listAllTransactions: repository.listAllTransactions,
      now: () => now,
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
    const summaryBefore = await getSummary();
    const affordabilityBefore = calculateAffordability(
      { itemName: 'Synthetic purchase', price: 500, monthsAhead: 1 },
      summaryBefore,
      { emergencyFundTarget: 100 },
    );

    for (const type of ['income', 'expense']) {
      await assert.rejects(
        repository.createTransaction(
          transactionInput({ date: '2026-01-15T12:00:00.001Z', type }),
          creationOptions(),
        ),
        /future-dated income and expense transactions are not supported/i,
      );
    }

    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
    const summaryAfter = await getSummary();
    assert.deepEqual(summaryAfter, summaryBefore);
    assert.deepEqual(
      calculateAffordability(
        { itemName: 'Synthetic purchase', price: 500, monthsAhead: 1 },
        summaryAfter,
        { emergencyFundTarget: 100 },
      ),
      affordabilityBefore,
    );
  });
});

test('transaction integration: accepts past and current dates but rejects a future-date edit without writes', async () => {
  await withFixture(async ({ database }) => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1_000 });
    const repository = createTransactionRepository(database, { userId: localUserId, now: () => now });

    await repository.createTransaction(transactionInput({ date: '2026-01-14T12:00:00.000Z', amount: 50 }), creationOptions());
    const current = await repository.createTransaction(transactionInput({ date: now.toISOString(), amount: 100 }), creationOptions());
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_150);
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(
      repository.updateTransaction(current.id, transactionInput({ date: '2026-01-15T12:00:00.001Z', amount: 200 })),
      /future-dated income and expense transactions are not supported/i,
    );

    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});

test('transaction integration: preserves legacy future rows for exact replay, unchanged-date update, and atomic deletion', async () => {
  await withFixture(async ({ database }) => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const futureDate = '2026-02-15T12:00:00.000Z';
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1_200 });
    await database.insert(schema.transactions).values({
      id: 600,
      clientId: 'legacy-future-request',
      userId: localUserId,
      accountId: 1,
      categoryId: null,
      date: futureDate,
      amount: 200,
      type: 'income',
      merchant: null,
      description: null,
    });
    const repository = createTransactionRepository(database, { userId: localUserId, now: () => now });

    const replay = await repository.createTransaction(
      transactionInput({ date: futureDate, amount: 200, type: 'income' }),
      creationOptions({ clientId: 'legacy-future-request' }),
    );
    assert.equal(replay.id, 600);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_200);

    const updated = await repository.updateTransaction(
      600,
      transactionInput({ date: futureDate, amount: 300, type: 'income' }),
    );
    assert.equal(updated?.date, futureDate);
    assert.equal(updated?.amount, 300);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_300);

    await repository.deleteTransaction(600);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_000);
    assert.equal((await database.select().from(schema.transactions).where(eq(schema.transactions.id, 600))).length, 0);
    await assert.rejects(repository.deleteTransaction(600), /transaction not found/i);
    assert.equal((await database.select().from(schema.accounts).where(eq(schema.accounts.id, 1)))[0].balance, 1_000);
  });
});
test('transaction integration: accepts valid persisted income, expense, and legacy transfer rows', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 25 });
    await database.insert(schema.transactions).values([
      { id: 701, clientId: 'persisted-income', userId: localUserId, accountId: 1, date: '2026-01-10T00:00:00.000Z', amount: 100, type: 'income' },
      { id: 702, clientId: 'persisted-expense', userId: localUserId, accountId: 1, date: '2026-01-11T00:00:00.000Z', amount: -50, type: 'expense' },
      { id: 703, clientId: 'persisted-legacy-transfer', userId: localUserId, accountId: 1, date: '2026-01-12T00:00:00.000Z', amount: -25, type: 'transfer' },
    ]);
    const repository = createTransactionRepository(database, { userId: localUserId, now: () => new Date('2026-01-15T00:00:00.000Z') });

    assert.deepEqual((await repository.listAllTransactions()).map((row) => [row.id, row.amount, row.type]), [
      [703, -25, 'transfer'], [702, -50, 'expense'], [701, 100, 'income'],
    ]);
    assert.equal((await repository.getTransaction(701))?.amount, 100);
  });
});

test('transaction integration: validates persisted financial rows before mapping or reconciliation', async () => {
  const invalidRows = [
    { name: 'non-integer amount', row: { id: 710, date: '2026-01-10T00:00:00.000Z', amount: 1.5, type: 'income' }, field: 'amount' },
    { name: 'unsafe amount', row: { id: 711, date: '2026-01-10T00:00:00.000Z', amount: Number.MAX_SAFE_INTEGER + 1, type: 'income' }, field: 'amount' },
    { name: 'invalid type', row: { id: 712, date: '2026-01-10T00:00:00.000Z', amount: 100, type: 'unsupported' }, field: 'type' },
    { name: 'noncanonical date', row: { id: 713, date: '2026-01-10T00:00:00+00:00', amount: 100, type: 'income' }, field: 'date' },
  ];

  for (const fixture of invalidRows) {
    await withFixture(async ({ database }) => {
      await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1_000 });
      await database.insert(schema.transactions).values({
        clientId: `invalid-persisted-${fixture.row.id}`,
        userId: localUserId,
        accountId: 1,
        categoryId: null,
        ...fixture.row,
      });
      const repository = createTransactionRepository(database, { userId: localUserId, now: () => new Date('2026-01-15T00:00:00.000Z') });
      const catalog = createCatalogRepository(database, { userId: localUserId });
      const pattern = new RegExp(`Invalid persisted transaction ${fixture.row.id}: ${fixture.field}`, 'i');

      await assert.rejects(repository.listTransactions(), pattern, fixture.name);
      await assert.rejects(repository.listAllTransactions(), pattern, fixture.name);
      await assert.rejects(repository.getTransaction(fixture.row.id), pattern, fixture.name);
      await assert.rejects(catalog.reconcileAccountBalances(), pattern, fixture.name);
    });
  }
});

test('transaction integration: invalid persisted rows fail reporting and mutation without writes', async () => {
  await withFixture(async ({ database }) => {
    await database.insert(schema.accounts).values({ id: 1, userId: localUserId, name: 'Primary', type: 'checking', balance: 1_000 });
    await database.insert(schema.transactions).values({
      id: 720,
      clientId: 'invalid-persisted-mutation',
      userId: localUserId,
      accountId: 1,
      categoryId: null,
      date: '2026-01-10T00:00:00.000Z',
      amount: 1.5,
      type: 'income',
    });
    const now = new Date('2026-01-15T00:00:00.000Z');
    const repository = createTransactionRepository(database, { userId: localUserId, now: () => now });
    const catalog = createCatalogRepository(database, { userId: localUserId });
    const getSummary = createSummaryService({
      listAccounts: catalog.listAccounts,
      listAllTransactions: repository.listAllTransactions,
      now: () => now,
    });
    const accountsBefore = await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const transactionsBefore = await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id));

    await assert.rejects(getSummary(), /Invalid persisted transaction 720: amount/i);
    await assert.rejects(
      repository.updateTransaction(720, transactionInput({ amount: 200, type: 'income' })),
      /Invalid persisted transaction 720: amount/i,
    );
    assert.deepEqual(await database.select().from(schema.accounts).orderBy(asc(schema.accounts.id)), accountsBefore);
    assert.deepEqual(await database.select().from(schema.transactions).orderBy(asc(schema.transactions.id)), transactionsBefore);
  });
});
