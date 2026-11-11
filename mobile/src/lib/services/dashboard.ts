import { getProfile, listActiveAccounts } from '../repositories/catalog';
import { getSummary, getRisk, getForecast } from './finance';
import { getFinancialHistoryState } from './history-start-state';
import { getSavingsPlanning } from './savings-planning';
import { getActivity } from './activity';
import { createDashboardService } from './dashboard-core';
export const getDashboard = createDashboardService({ getSummary, getRisk, getForecast, getProfile,
  getHistory: getFinancialHistoryState, getSavingsPlanning, getActivity, listActiveAccounts, now: () => new Date() });
