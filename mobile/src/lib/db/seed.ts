import { eq } from 'drizzle-orm';
import { accounts, categories, savingsGoals, userProfiles, users } from './schema';
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
    tx.insert(categories).values(CATEGORY_SEED.map(([name, parent, isEssential, isHighRisk]) => ({ name, parent, isEssential, isHighRisk }))).run();
    tx.insert(savingsGoals).values({ userId: LOCAL_USER_ID, name: 'Emergency Fund', targetAmount: 240_000, targetDate: new Date(new Date().getFullYear() + 1, 0, 1).toISOString(), currentAmount: 0 }).run();
  });
}
