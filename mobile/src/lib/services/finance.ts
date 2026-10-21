import { getProfile, listAccounts, listCategories } from '@/lib/repositories/catalog';
import { listAllTransactions } from '@/lib/repositories/transactions';
import { calculateAffordability, calculateRisk, createSummaryService } from '@/lib/services/finance-core';
import { createForecastReadinessService } from '@/lib/services/forecast-readiness-core';
import { getFinancialHistoryState } from '@/lib/services/history-start-state';
import type { Affordability, Risk } from '@/lib/types';

export const getSummary = createSummaryService({ listAccounts, listAllTransactions, now: () => new Date() });

export const getForecast = createForecastReadinessService({
  getFinancialHistoryState,
  listAllTransactions,
  now: () => new Date(),
});

export async function getRisk(asOf = new Date()): Promise<Risk> {
  const [summary, profile, categories, transactions] = await Promise.all([getSummary(asOf), getProfile(), listCategories(), listAllTransactions()]);
  return calculateRisk(summary, profile, categories, transactions, asOf);
}

export async function getAffordability(input: { itemName: string; price: number; monthsAhead: number }): Promise<Affordability> {
  const [summary, profile] = await Promise.all([getSummary(), getProfile()]);
  return calculateAffordability(input, summary, profile);
}
