import { and, asc, eq } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, categoryApplicability, transactions, userProfiles } from '@/lib/db/schema';
import type { CategoryApplicabilityRow, CategoryRow } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/types';
import { validatePersistedTransaction } from '@/lib/validation/transaction';

export type CatalogRepositoryDependencies = {
  userId: number;
};

const unsafeReconciliationError = 'Account reconciliation requires JavaScript safe integer monetary values.';

function checkedMoneyAdd(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error(unsafeReconciliationError);
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeReconciliationError);
  return result;
}

function checkedMoneySubtract(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error(unsafeReconciliationError);
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeReconciliationError);
  return result;
}

export type AccountBalanceReconciliation = {
  accountId: number;
  accountName: string;
  storedBalance: number;
  transactionEffectTotal: number;
  candidateOpeningBalance: number;
  status: 'matched' | 'discrepancy';
};

export type CatalogCategory = CategoryRow & {
  applicableTransactionTypes: CategoryApplicabilityRow['transactionType'][];
};

export function createCatalogRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: CatalogRepositoryDependencies = { userId: LOCAL_USER_ID },
) {
  const listAccounts = () => database.select().from(accounts)
    .where(eq(accounts.userId, dependencies.userId)).orderBy(asc(accounts.name));

  async function listCategories(): Promise<CatalogCategory[]> {
    const [categoryRows, applicabilityRows] = await Promise.all([
      database.select().from(categories).orderBy(asc(categories.name)),
      database.select().from(categoryApplicability)
        .orderBy(asc(categoryApplicability.categoryId), asc(categoryApplicability.transactionType)),
    ]);
    const applicabilityByCategory = new Map<number, CategoryApplicabilityRow['transactionType'][]>();
    for (const row of applicabilityRows) {
      const transactionTypes = applicabilityByCategory.get(row.categoryId) ?? [];
      transactionTypes.push(row.transactionType);
      applicabilityByCategory.set(row.categoryId, transactionTypes);
    }
    return categoryRows.map((category): CatalogCategory => ({
      ...category,
      applicableTransactionTypes: applicabilityByCategory.get(category.id) ?? [],
    }));
  }

  async function reconcileAccountBalances(): Promise<AccountBalanceReconciliation[]> {
    return database.transaction((tx) => {
      const accountRows = tx.select({
        accountId: accounts.id,
        accountName: accounts.name,
        storedBalance: accounts.balance,
      }).from(accounts).where(eq(accounts.userId, dependencies.userId)).orderBy(asc(accounts.name)).all();
      const effectRows = tx.select({
        id: transactions.id,
        clientId: transactions.clientId,
        userId: transactions.userId,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
      }).from(transactions).innerJoin(accounts, and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.userId, dependencies.userId),
      )).where(eq(transactions.userId, dependencies.userId)).all();

      const effectTotals = new Map(accountRows.map((account) => [account.accountId, 0]));
      for (const effect of effectRows) {
        const validEffect = validatePersistedTransaction(effect);
        const current = effectTotals.get(validEffect.accountId);
        if (current === undefined) continue;
        effectTotals.set(validEffect.accountId, checkedMoneyAdd(current, validEffect.amount));
      }

      return accountRows.map((account) => {
        const transactionEffectTotal = effectTotals.get(account.accountId) ?? 0;
        const candidateOpeningBalance = checkedMoneySubtract(account.storedBalance, transactionEffectTotal);
        return {
          ...account,
          transactionEffectTotal,
          candidateOpeningBalance,
          status: candidateOpeningBalance === 0 ? 'matched' as const : 'discrepancy' as const,
        };
      });
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
