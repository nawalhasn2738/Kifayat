import { and, asc, eq } from 'drizzle-orm';
import { accounts, openingBalanceAudit, transactions, transfers } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import { validatePersistedTransaction } from '@/lib/validation/transaction';
import { validatePersistedTransfer } from '@/lib/validation/transfer';

const invalidMoney = 'Opening balances require JavaScript safe integer monetary values.';
function add(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error(invalidMoney);
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(invalidMoney);
  return value;
}
function subtract(left: number, right: number) { return add(left, -right); }
function validateValue(value: unknown) {
  if (!Number.isSafeInteger(value)) throw new Error(invalidMoney);
  return value as number;
}

export type OpeningBalanceState =
  | { status: 'missing_account' }
  | { status: 'ambiguous'; accountId: number; openingBalance: number | null; reason: 'legacy_transfer' | 'invalid_transfer' }
  | { status: 'available'; accountId: number; openingBalance: number | null; currentBalance: number; candidate: number };

export function createOpeningBalanceRepository<TRunResult>(database: AppDatabase<TRunResult>, dependencies = {
  userId: LOCAL_USER_ID, now: () => new Date(),
}) {
  function stateIn(tx: Parameters<Parameters<typeof database.transaction>[0]>[0], accountId: number): OpeningBalanceState {
    const [account] = tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, dependencies.userId))).limit(1).all();
    if (!account) return { status: 'missing_account' };
    validateValue(account.balance);
    if (account.openingBalance !== null) validateValue(account.openingBalance);
    const rows = tx.select().from(transactions).where(and(eq(transactions.accountId, accountId), eq(transactions.userId, dependencies.userId))).all();
    let effects = 0;
    for (const row of rows) {
      const valid = validatePersistedTransaction(row);
      if (valid.type === 'transfer') return { status: 'ambiguous', accountId, openingBalance: account.openingBalance, reason: 'legacy_transfer' };
      effects = add(effects, valid.amount);
    }
    const ownedAccountIds = new Set(tx.select({ id: accounts.id }).from(accounts)
      .where(eq(accounts.userId, dependencies.userId)).all().map((row) => row.id));
    const transferRows = tx.select().from(transfers).where(eq(transfers.userId, dependencies.userId)).all();
    for (const row of transferRows) {
      let valid: typeof row;
      try { valid = validatePersistedTransfer(row); }
      catch { return { status: 'ambiguous', accountId, openingBalance: account.openingBalance, reason: 'invalid_transfer' }; }
      if (!ownedAccountIds.has(valid.sourceAccountId) || !ownedAccountIds.has(valid.destinationAccountId)) {
        return { status: 'ambiguous', accountId, openingBalance: account.openingBalance, reason: 'invalid_transfer' };
      }
      if (valid.sourceAccountId === accountId) effects = subtract(effects, valid.amount);
      if (valid.destinationAccountId === accountId) effects = add(effects, valid.amount);
    }
    return { status: 'available', accountId, openingBalance: account.openingBalance,
      currentBalance: account.balance, candidate: subtract(account.balance, effects) };
  }
  const getState = async (accountId: number) => database.transaction((tx) => stateIn(tx, accountId));
  async function confirm(accountId: number, proposed: number) {
    validateValue(proposed);
    return database.transaction((tx) => {
      const state = stateIn(tx, accountId);
      if (state.status === 'missing_account') throw new Error('Account not found.');
      if (state.status === 'ambiguous') throw new Error('Opening balance is unavailable because legacy transfer history is ambiguous.');
      if (state.openingBalance !== null) throw new Error('Opening balance is already confirmed.');
      const newBalance = add(state.currentBalance, subtract(proposed, state.candidate));
      tx.update(accounts).set({ openingBalance: proposed, balance: newBalance }).where(and(
        eq(accounts.id, accountId), eq(accounts.userId, dependencies.userId),
      )).run();
      tx.insert(openingBalanceAudit).values({ accountId, previousOpeningBalance: null,
        newOpeningBalance: proposed, changeKind: 'confirmation', changedAt: dependencies.now().toISOString() }).run();
      return { openingBalance: proposed, currentBalance: newBalance };
    });
  }
  async function correct(accountId: number, expected: number, proposed: number) {
    validateValue(expected); validateValue(proposed);
    if (expected === proposed) throw new Error('Opening balance is unchanged.');
    return database.transaction((tx) => {
      const state = stateIn(tx, accountId);
      if (state.status === 'missing_account') throw new Error('Account not found.');
      if (state.status === 'ambiguous') throw new Error('Opening balance is unavailable because legacy transfer history is ambiguous.');
      if (state.openingBalance === null) throw new Error('Opening balance is not confirmed.');
      if (state.openingBalance !== expected) throw new Error('Opening balance changed; refresh and try again.');
      const newBalance = add(state.currentBalance, subtract(proposed, expected));
      tx.update(accounts).set({ openingBalance: proposed, balance: newBalance }).where(and(
        eq(accounts.id, accountId), eq(accounts.userId, dependencies.userId), eq(accounts.openingBalance, expected),
      )).run();
      tx.insert(openingBalanceAudit).values({ accountId, previousOpeningBalance: expected,
        newOpeningBalance: proposed, changeKind: 'correction', changedAt: dependencies.now().toISOString() }).run();
      return { openingBalance: proposed, currentBalance: newBalance };
    });
  }
  const history = (accountId: number) => database.select().from(openingBalanceAudit)
    .innerJoin(accounts, and(eq(accounts.id, openingBalanceAudit.accountId), eq(accounts.userId, dependencies.userId)))
    .where(eq(openingBalanceAudit.accountId, accountId)).orderBy(asc(openingBalanceAudit.changedAt));
  return { getState, confirm, correct, history };
}
