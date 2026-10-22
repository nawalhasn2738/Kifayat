import { and, eq, ne, or, sql } from 'drizzle-orm';
import { accounts, openingBalanceAudit, transactions, transfers } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import {
  normalizeAccountName,
  type AccountCreationInput,
  validateAccountCreationInput,
} from '@/lib/validation/account';

export type AccountLifecycleErrorCode =
  | 'invalid_name'
  | 'invalid_type'
  | 'invalid_opening_balance'
  | 'duplicate_name'
  | 'account_not_found'
  | 'account_archived'
  | 'stale_account'
  | 'last_active_account'
  | 'account_in_use';

export class AccountLifecycleError extends Error {
  constructor(public readonly code: AccountLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'AccountLifecycleError';
  }
}

type Dependencies = { userId: number; now: () => Date };
const productionDependencies: Dependencies = { userId: LOCAL_USER_ID, now: () => new Date() };

function validationError(error: unknown): AccountLifecycleError {
  const message = error instanceof Error ? error.message : 'Invalid account details.';
  if (/name/i.test(message)) return new AccountLifecycleError('invalid_name', message);
  if (/type/i.test(message)) return new AccountLifecycleError('invalid_type', message);
  return new AccountLifecycleError('invalid_opening_balance', message);
}

function isUniqueFailure(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed|accounts_user_name_nocase_unique/i.test(error.message);
}

export function createAccountRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: Dependencies = productionDependencies,
) {
  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

  function owned(tx: Tx, id: number) {
    const [account] = tx.select().from(accounts).where(and(
      eq(accounts.id, id), eq(accounts.userId, dependencies.userId),
    )).limit(1).all();
    if (!account) throw new AccountLifecycleError('account_not_found', 'Account not found.');
    return account;
  }

  function requireAvailableName(tx: Tx, name: string, excludingId?: number) {
    const where = excludingId === undefined
      ? and(eq(accounts.userId, dependencies.userId), sql`lower(${accounts.name}) = lower(${name})`)
      : and(eq(accounts.userId, dependencies.userId), ne(accounts.id, excludingId),
        sql`lower(${accounts.name}) = lower(${name})`);
    if (tx.select({ id: accounts.id }).from(accounts).where(where).limit(1).all().length) {
      throw new AccountLifecycleError('duplicate_name', 'An account with this name already exists.');
    }
  }

  async function listManagedAccounts() {
    return database.select().from(accounts)
      .where(eq(accounts.userId, dependencies.userId))
      .orderBy(sql`${accounts.archivedAt} is not null`, accounts.name);
  }

  async function createAccount(raw: AccountCreationInput) {
    let input: AccountCreationInput;
    try { input = validateAccountCreationInput(raw); } catch (error) { throw validationError(error); }
    try {
      const id = database.transaction((tx) => {
        requireAvailableName(tx, input.name);
        const [created] = tx.insert(accounts).values({
          userId: dependencies.userId,
          name: input.name,
          type: input.type,
          balance: input.openingBalance,
          openingBalance: input.openingBalance,
        }).returning({ id: accounts.id }).all();
        tx.insert(openingBalanceAudit).values({
          accountId: created.id,
          previousOpeningBalance: null,
          newOpeningBalance: input.openingBalance,
          changeKind: 'confirmation',
          changedAt: dependencies.now().toISOString(),
        }).run();
        return created.id;
      });
      return (await listManagedAccounts()).find((account) => account.id === id)!;
    } catch (error) {
      if (error instanceof AccountLifecycleError) throw error;
      if (isUniqueFailure(error)) throw new AccountLifecycleError('duplicate_name', 'An account with this name already exists.');
      throw new AccountLifecycleError('account_in_use', 'The account could not be created.');
    }
  }

  async function renameAccount(id: number, expectedCurrentName: string, proposedName: string) {
    let name: string;
    try { name = normalizeAccountName(proposedName); } catch (error) { throw validationError(error); }
    try {
      database.transaction((tx) => {
        const account = owned(tx, id);
        if (account.archivedAt !== null) throw new AccountLifecycleError('account_archived', 'Restore this account before renaming it.');
        if (account.name !== expectedCurrentName) throw new AccountLifecycleError('stale_account', 'Account details changed; refresh and try again.');
        if (account.name === name) throw new AccountLifecycleError('invalid_name', 'Enter a different account name.');
        requireAvailableName(tx, name, id);
        const changed = tx.update(accounts).set({ name }).where(and(
          eq(accounts.id, id), eq(accounts.userId, dependencies.userId),
          eq(accounts.name, expectedCurrentName), eq(accounts.archivedAt, null),
        )).run();
        if (changed.changes !== 1) throw new AccountLifecycleError('stale_account', 'Account details changed; refresh and try again.');
      });
    } catch (error) {
      if (error instanceof AccountLifecycleError) throw error;
      if (isUniqueFailure(error)) throw new AccountLifecycleError('duplicate_name', 'An account with this name already exists.');
      throw new AccountLifecycleError('account_in_use', 'The account could not be renamed.');
    }
  }

  async function archiveAccount(id: number) {
    database.transaction((tx) => {
      const account = owned(tx, id);
      if (account.archivedAt !== null) throw new AccountLifecycleError('stale_account', 'Account is already archived.');
      const [{ count }] = tx.select({ count: sql<number>`count(*)` }).from(accounts).where(and(
        eq(accounts.userId, dependencies.userId), eq(accounts.archivedAt, null),
      )).all();
      if (count <= 1) throw new AccountLifecycleError('last_active_account', 'At least one active account is required.');
      const changed = tx.update(accounts).set({ archivedAt: dependencies.now().toISOString() }).where(and(
        eq(accounts.id, id), eq(accounts.userId, dependencies.userId), eq(accounts.archivedAt, null),
      )).run();
      if (changed.changes !== 1) throw new AccountLifecycleError('stale_account', 'Account status changed; refresh and try again.');
    });
  }

  async function restoreAccount(id: number, expectedArchivedAt: string) {
    database.transaction((tx) => {
      const account = owned(tx, id);
      if (account.archivedAt === null || account.archivedAt !== expectedArchivedAt) {
        throw new AccountLifecycleError('stale_account', 'Account status changed; refresh and try again.');
      }
      const changed = tx.update(accounts).set({ archivedAt: null }).where(and(
        eq(accounts.id, id), eq(accounts.userId, dependencies.userId),
        eq(accounts.archivedAt, expectedArchivedAt),
      )).run();
      if (changed.changes !== 1) throw new AccountLifecycleError('stale_account', 'Account status changed; refresh and try again.');
    });
  }

  async function deleteUnusedAccount(id: number) {
    database.transaction((tx) => {
      const account = owned(tx, id);
      const [{ count: activeCount }] = tx.select({ count: sql<number>`count(*)` }).from(accounts).where(and(
        eq(accounts.userId, dependencies.userId), eq(accounts.archivedAt, null),
      )).all();
      if (account.archivedAt === null && activeCount <= 1) {
        throw new AccountLifecycleError('last_active_account', 'At least one active account is required.');
      }
      const referenced = tx.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.accountId, id)).limit(1).all().length
        || tx.select({ id: transfers.id }).from(transfers).where(or(
          eq(transfers.sourceAccountId, id), eq(transfers.destinationAccountId, id),
        )).limit(1).all().length
        || tx.select({ id: openingBalanceAudit.id }).from(openingBalanceAudit)
          .where(eq(openingBalanceAudit.accountId, id)).limit(1).all().length;
      if (account.balance !== 0 || account.openingBalance !== null || referenced) {
        throw new AccountLifecycleError('account_in_use', 'Only a zero-balance account with no financial or audit history can be deleted.');
      }
      const deleted = tx.delete(accounts).where(and(
        eq(accounts.id, id), eq(accounts.userId, dependencies.userId),
        eq(accounts.balance, 0), eq(accounts.openingBalance, null),
      )).run();
      if (deleted.changes !== 1) throw new AccountLifecycleError('stale_account', 'Account details changed; refresh and try again.');
    });
  }

  return { listManagedAccounts, createAccount, renameAccount, archiveAccount, restoreAccount, deleteUnusedAccount };
}
