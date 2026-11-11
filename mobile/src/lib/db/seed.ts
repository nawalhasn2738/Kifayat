import { eq } from 'drizzle-orm';
import { accounts, categories, categoryApplicability, savingsGoals, userProfiles, users } from './schema';
import type { AppDatabase } from './types';

export const LOCAL_USER_ID = 1;
export const CATEGORY_SEED = [
  ['salary', 'Income', false, false], ['freelance', 'Income', false, false],
  ['groceries', 'Essentials', true, false], ['fuel', 'Essentials', true, false],
  ['utilities', 'Essentials', true, false], ['internet_mobile', 'Essentials', true, false],
  ['transport', 'Essentials', true, false], ['healthcare', 'Essentials', true, false],
  ['university', 'Obligations', true, false], ['family_support', 'Obligations', true, false],
  ['charity', 'Obligations', false, false], ['food_delivery', 'Lifestyle', false, true],
  ['dine_out', 'Lifestyle', false, true], ['subscriptions', 'Lifestyle', false, false],
  ['online_shopping', 'Lifestyle', false, true], ['entertainment', 'Lifestyle', false, true],
  ['personal_care', 'Lifestyle', false, false], ['savings_transfer', 'Transfer', false, false],
  ['anomaly', 'Anomaly', false, true],
] as const;

export const CATEGORY_APPLICABILITY_SEED = [
  ['salary', 'income'], ['freelance', 'income'],
  ['groceries', 'expense'], ['fuel', 'expense'], ['utilities', 'expense'],
  ['internet_mobile', 'expense'], ['transport', 'expense'], ['healthcare', 'expense'],
  ['university', 'expense'], ['family_support', 'expense'], ['charity', 'expense'],
  ['food_delivery', 'expense'], ['dine_out', 'expense'], ['subscriptions', 'expense'],
  ['online_shopping', 'expense'], ['entertainment', 'expense'], ['personal_care', 'expense'],
] as const;

export async function seedLocalProfile<TRunResult>(database: AppDatabase<TRunResult>) {
  const existing = await database.select({ id: users.id }).from(users).where(eq(users.id, LOCAL_USER_ID)).limit(1);
  if (existing.length) return;
  database.transaction((tx) => {
    tx.insert(users).values({ id: LOCAL_USER_ID, email: 'local@kifayat.app', name: 'Kifayat User' }).run();
    tx.insert(userProfiles).values({ userId: LOCAL_USER_ID, monthlyIncome: 120_000, emergencyFundTarget: 240_000 }).run();
    tx.insert(accounts).values([
      { userId: LOCAL_USER_ID, name: 'Main Account', type: 'checking', balance: 0 },
      { userId: LOCAL_USER_ID, name: 'Savings', type: 'savings', balance: 0 },
      { userId: LOCAL_USER_ID, name: 'Cash Wallet', type: 'cash', balance: 0 },
    ]).run();
    const seededCategories = tx.insert(categories)
      .values(CATEGORY_SEED.map(([name, parent, isEssential, isHighRisk]) => ({ name, parent, isEssential, isHighRisk })))
      .returning({ id: categories.id, name: categories.name }).all();
    const categoryIdsByName = new Map(seededCategories.map((category) => [category.name, category.id]));
    tx.insert(categoryApplicability).values(CATEGORY_APPLICABILITY_SEED.map(([name, transactionType]) => {
      const categoryId = categoryIdsByName.get(name);
      if (categoryId === undefined) throw new Error(`Missing seeded category applicability target: ${name}`);
      return { categoryId, transactionType };
    })).run();
    tx.insert(savingsGoals).values({ userId: LOCAL_USER_ID, name: 'Emergency Fund', targetAmount: 240_000, targetDate: new Date(new Date().getFullYear() + 1, 0, 1).toISOString(), currentAmount: 0 }).run();
  });
}
