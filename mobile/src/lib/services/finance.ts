import { getProfile, listAccounts, listCategories } from '@/lib/repositories/catalog';
import { listAllTransactions } from '@/lib/repositories/transactions';
import { calculateAffordability, calculateForecast, calculateRisk, createSummaryService } from '@/lib/services/finance-core';
import type { Affordability, Forecast, Risk } from '@/lib/types';

export const getSummary = createSummaryService({ listAccounts, listAllTransactions, now: () => new Date() });

export async function getForecast(asOf = new Date()): Promise<Forecast> {
  return calculateForecast(await listAllTransactions(), asOf);
}

export async function getRisk(asOf = new Date()): Promise<Risk> {
  const [summary, profile, categories, transactions] = await Promise.all([getSummary(asOf), getProfile(), listCategories(), listAllTransactions()]);
  return calculateRisk(summary, profile, categories, transactions, asOf);
}

export async function getAffordability(input: { itemName: string; price: number; monthsAhead: number }): Promise<Affordability> {
  const [summary, profile] = await Promise.all([getSummary(), getProfile()]);
  return calculateAffordability(input, summary, profile);
}
