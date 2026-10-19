import { and, asc, eq, sql } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, transactions, userProfiles } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/types';

export type CatalogRepositoryDependencies = {
  userId: number;
};

export type AccountBalanceReconciliation = {
  accountId: number;
  accountName: string;
  storedBalance: number;
  transactionEffectTotal: number;
  candidateOpeningBalance: number;
  status: 'matched' | 'discrepancy';
};

export function createCatalogRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: CatalogRepositoryDependencies = { userId: LOCAL_USER_ID },
) {
  const listAccounts = () => database.select().from(accounts)
    .where(eq(accounts.userId, dependencies.userId)).orderBy(asc(accounts.name));

  const listCategories = () => database.select().from(categories).orderBy(asc(categories.name));

  async function reconcileAccountBalances(): Promise<AccountBalanceReconciliation[]> {
    const rows = await database.select({
      accountId: accounts.id,
      accountName: accounts.name,
      storedBalance: accounts.balance,
      transactionEffectTotal: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    }).from(accounts).leftJoin(transactions, and(
      eq(transactions.accountId, accounts.id),
      eq(transactions.userId, dependencies.userId),
    )).where(eq(accounts.userId, dependencies.userId))
      .groupBy(accounts.id, accounts.name, accounts.balance).orderBy(asc(accounts.name));

    return rows.map((row) => {
      const transactionEffectTotal = Number(row.transactionEffectTotal);
      const candidateOpeningBalance = row.storedBalance - transactionEffectTotal;
      return {
        ...row,
        transactionEffectTotal,
        candidateOpeningBalance,
        status: candidateOpeningBalance === 0 ? 'matched' as const : 'discrepancy' as const,
      };
    });
  }

  async function getProfile() {
    const [profile] = await database.select().from(userProfiles)
      .where(eq(userProfiles.userId, dependencies.userId)).limit(1);
    if (!profile) throw new Error('Local profile is unavailable.');
    return profile;
  }

  return { listAccounts, listCategories, getProfile, reconcileAccountBalances };
}
