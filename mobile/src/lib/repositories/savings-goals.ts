import { db } from '@/lib/db/client';
import { createSavingsGoalRepository } from './savings-goals-core';
export const { listGoals, createGoal, updateGoalTarget } = createSavingsGoalRepository(db);
