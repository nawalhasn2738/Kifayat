import { reportingMonthKey } from '../finance/reporting-calendar';
import type { SavingsGoal } from '../repositories/savings-goals-core';
import type { FinancialHistoryState } from './history-start-state-core';
import type { ForecastResult, Summary, Transaction } from '../types';
import { meanMoney, monthly, transactionsAtOrBefore } from './finance-core';
import { calculateSavingsRecommendation, calculateInstallmentSafety } from '../finance/planning-rules';
import { MAX_PKR_AMOUNT } from '../validation/transaction';
import { validatePlanningHorizon } from '../validation/affordability';

function checkedSum(values: number[]) {
  return values.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(next)) throw new Error('Savings totals are outside the supported range.');
    return next;
  }, 0);
}
export function goalProgress(target: number, netSavings: number | null) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('Invalid goal target.');
  if (netSavings === null) return { current: null, netSavings: null, remaining: null, percent: null };
  if (!Number.isSafeInteger(netSavings)) throw new Error('Invalid savings total.');
  const current = Math.max(0, netSavings);
  return { current, netSavings, remaining: Math.max(0, target - current), percent: Math.min(100, Math.max(0, current / target * 100)) };
}
export type SavingsPlanningDependencies = {
  listGoals: () => Promise<SavingsGoal[]>;
  getHistory: () => Promise<FinancialHistoryState>;
  getForecast: (asOf: Date) => Promise<ForecastResult>;
  getSummary: (asOf: Date) => Promise<Summary>;
  listAllTransactions: () => Promise<Transaction[]>;
  listCategories: () => Promise<{ id: number; name: string; isEssential: boolean }[]>;
  now: () => Date;
};
export function createSavingsPlanningService(dependencies: SavingsPlanningDependencies) {
  async function getSavingsPlanning(asOf = dependencies.now()) {
    const goals = await dependencies.listGoals();
    let history: FinancialHistoryState;
    try { history = await dependencies.getHistory(); }
    catch { history = { status: 'missing_profile' }; }
    if (history.status !== 'confirmed') return {
      asOf: asOf.toISOString(), progressStatus: 'unavailable' as const,
      progressReason: 'Confirm complete financial history in Planning before relying on recorded savings progress.',
      goals: goals.map(goal => ({ ...goal, progress: goalProgress(goal.targetAmount, null) })),
      analysis: { status: 'unavailable' as const, guidance: 'Financial history is missing, invalid or unconfirmed. No savings recommendation or installment assessment is available.' },
    };
    let transactions: Transaction[];
    let summary: Summary;
    try {
      transactions = transactionsAtOrBefore(await dependencies.listAllTransactions(), asOf);
      summary = await dependencies.getSummary(asOf);
      if (!summary.balances.length) throw new Error('No accounts are available.');
    }
    catch { return {
      asOf: asOf.toISOString(), progressStatus: 'unavailable' as const, progressReason: 'Recorded transactions could not be verified. Refresh before relying on progress.',
      goals: goals.map(goal => ({ ...goal, progress: goalProgress(goal.targetAmount, null) })),
      analysis: { status: 'unavailable' as const, guidance: 'Recorded transactions could not be verified.' },
    }; }
    const sinceStart = transactions.filter(row => row.date >= history.value);
    const netSavings = checkedSum(monthly(sinceStart).map(row => row.savings));
    const progress = { asOf: asOf.toISOString(), progressStatus: 'ready' as const,
      progressReason: `Shared recorded net savings since ${history.calendarDate}, through ${asOf.toISOString()}. This is income minus expenses, not an earmarked cash balance. Transfers are excluded.`,
      goals: goals.map(goal => ({ ...goal, progress: goalProgress(goal.targetAmount, netSavings) })),
    };
    try {
      const forecast = await dependencies.getForecast(asOf);
      if (forecast.status !== 'ready') return { ...progress, analysis: { status: 'unavailable' as const, guidance: forecast.guidance + ' Recommendations require three preceding complete Karachi months; the current partial month is excluded.' } };
      const months = forecast.qualifyingMonths.map(month => summary.monthlyTotals.find(row => row.month === month) ?? { month, income: 0, expense: 0, savings: 0 });
      const income = Math.round(meanMoney(months.map(row => row.income)));
      const expectedExpenses = Math.round(meanMoney(months.map(row => row.expense)));
      const recommendation = calculateSavingsRecommendation({ income, expectedExpenses });
      const categories = await dependencies.listCategories();
      const essential = new Set(categories.filter(row => row.isEssential).map(row => row.id));
      const eligible = transactions.filter(row => row.type === 'expense' && forecast.qualifyingMonths.includes(reportingMonthKey(row.date)));
      const categoryTotals = new Map<string, number>();
      let unknownCategory = false;
      for (const row of eligible) {
        const label = row.category?.name ?? 'uncategorized';
        categoryTotals.set(label, checkedSum([categoryTotals.get(label) ?? 0, Math.abs(row.amount)]));
        if (!row.category || !categories.some(category => category.id === row.category!.id)) unknownCategory = true;
      }
      const essentialMonthlySpend = checkedSum(eligible.filter(row => row.category && essential.has(row.category.id)).map(row => Math.abs(row.amount))) / 3;
      return { ...progress, analysis: { status: 'ready' as const, qualifyingMonths: forecast.qualifyingMonths, income, expectedExpenses,
        recommendation, essentialMonthlySpend, installmentReady: !unknownCategory,
        patterns: [...categoryTotals].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 3),
      } };
    } catch { return { ...progress, analysis: { status: 'unavailable' as const, guidance: 'Financial summaries or category information could not be verified. No recommendation is available.' } }; }
  }
  return { getSavingsPlanning };
}
export type SavingsPlanning = Awaited<ReturnType<ReturnType<typeof createSavingsPlanningService>['getSavingsPlanning']>>;
export function assessRecordedInstallment(data: SavingsPlanning, input: { price: number; months: number; apr: number }) {
  if (!Number.isSafeInteger(input.price) || input.price <= 0 || input.price > MAX_PKR_AMOUNT) throw new Error('Enter a valid positive whole-PKR price.');
  validatePlanningHorizon(input.months);
  if (!Number.isFinite(input.apr) || input.apr < 0 || input.apr > 1) throw new Error('Enter an APR percentage from 0 to 100.');
  if (data.analysis.status !== 'ready' || !data.analysis.installmentReady) throw new Error('Installment assessment needs complete history and classified expense categories.');
  const result = calculateInstallmentSafety({ income: data.analysis.income, essentialMonthlySpend: data.analysis.essentialMonthlySpend }, input);
  if (!Number.isSafeInteger(result.monthly) || !Number.isFinite(result.ratio)) throw new Error('Installment estimate is outside the supported range.');
  return result;
}
