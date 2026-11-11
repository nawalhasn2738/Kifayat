import { listGoals } from '../repositories/savings-goals';
import { listCategories } from '../repositories/catalog';
import { listAllTransactions } from '../repositories/transactions';
import { getFinancialHistoryState } from './history-start-state';
import { getForecast, getSummary } from './finance';
import { createSavingsPlanningService } from './savings-planning-core';
export const { getSavingsPlanning } = createSavingsPlanningService({
  listGoals, listCategories, listAllTransactions, getHistory: getFinancialHistoryState,
  getForecast, getSummary, now: () => new Date(),
});
