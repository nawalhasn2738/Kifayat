import { and, asc, eq } from 'drizzle-orm';
import { savingsGoals } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import { validateGoalCreation, validateGoalTarget } from '../validation/savings-goal';
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export function createSavingsGoalRepository<TRunResult>(database: AppDatabase<TRunResult>, dependencies = { userId: LOCAL_USER_ID }) {
  const listGoals = async () => {
    const rows = await database.select().from(savingsGoals).where(eq(savingsGoals.userId, dependencies.userId)).orderBy(asc(savingsGoals.id));
    for (const row of rows) {
      validateGoalCreation(row);
      if (!Number.isSafeInteger(row.currentAmount) || row.currentAmount < 0) throw new Error('Stored goal progress needs attention.');
    }
    return rows;
  };
  const createGoal = async (input: { name: string; targetAmount: number; targetDate: string }) => {
    const valid = validateGoalCreation(input);
    const [goal] = await database.insert(savingsGoals).values({ ...valid, userId: dependencies.userId, currentAmount: 0 }).returning();
    return goal;
  };
  const updateGoalTarget = async (id: number, targetAmount: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid goal.');
    validateGoalTarget(targetAmount);
    const [goal] = await database.update(savingsGoals).set({ targetAmount }).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, dependencies.userId))).returning();
    if (!goal) throw new Error('Goal unavailable. Refresh and try again.');
    return goal;
  };
  return { listGoals, createGoal, updateGoalTarget };
}
