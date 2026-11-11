import { planningIntent } from '../chat/planning';
import { reportingMonthKey, reportingMonthRange } from '@/lib/finance/reporting-calendar';
import { createSummaryService, transactionsAtOrBefore } from '@/lib/services/finance-core';
import { parseChatRequest, type FinancialContext, type Period, type ChatMessage } from '../chat/contract';
import type { FinancialHistoryState } from './history-start-state-core';
import type { AffordabilityAssessment, ForecastResult, Summary, Transaction } from '@/lib/types';

type ContextAccount = { id: number; name: string; type: string; balance: number };
export type ChatContextDependencies = {
  listAccounts: () => Promise<ContextAccount[]>;
  listAllTransactions: () => Promise<Transaction[]>;
  getHistory: () => Promise<FinancialHistoryState>;
  getForecast: (asOf: Date) => Promise<ForecastResult>;
  getAffordability?: (input: { itemName: string; price: number; monthsAhead: number }, asOf: Date, snapshot: { summary: Summary; forecast: ForecastResult }) => Promise<AffordabilityAssessment>;
  now: () => Date;
};

export function createChatContextProvider(dependencies: ChatContextDependencies) {
  return async function getChatContext(messages: ChatMessage[] = [{ role: 'user', content: 'This month spending' }]): Promise<FinancialContext> {
    const asOf = dependencies.now();
    const [accounts, allTransactions, historyState, forecast] = await Promise.all([
      dependencies.listAccounts(), dependencies.listAllTransactions(), dependencies.getHistory(), dependencies.getForecast(asOf),
    ]);
    const ownedIds = new Set(accounts.map((account) => account.id));
    if (allTransactions.some((transaction) => !ownedIds.has(transaction.account.id))) {
      throw new Error('Local financial records need attention before chat can use them.');
    }
    const txs = transactionsAtOrBefore(allTransactions, asOf);
    // Reuse the existing summary arithmetic with a captured set of owned rows and one cutoff.
    const summary = await createSummaryService({
      listAccounts: async () => accounts, listAllTransactions: async () => txs, now: () => asOf,
    })(asOf);
    const history: FinancialContext['history'] = historyState.status === 'confirmed'
      ? { status: 'confirmed', startedAt: historyState.value }
      : { status: historyState.status === 'unconfirmed' ? 'unconfirmed' : 'unavailable', startedAt: null };
    const currentKey = reportingMonthKey(asOf);
    const currentRange = reportingMonthRange(currentKey);
    const previousKey = reportingMonthKey(new Date(currentRange.start.getTime() - 1));
    function period(month: string, through: Date): Period {
      const range = reportingMonthRange(month);
      const totals = summary.monthlyTotals.find((item) => item.month === month) ?? { income: 0, expense: 0, savings: 0 };
      const categoryTotals = new Map<string, number>();
      for (const transaction of txs) {
        if (transaction.type !== 'expense' || reportingMonthKey(transaction.date) !== month) continue;
        const name = transaction.category?.name ?? 'uncategorized';
        const total = (categoryTotals.get(name) ?? 0) + Math.abs(transaction.amount);
        if (!Number.isSafeInteger(total)) throw new Error('Category total is outside the supported range.');
        categoryTotals.set(name, total);
      }
      return {
        month, start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString(), through: through.toISOString(),
        coverage: history.status === 'confirmed' ? (history.startedAt! <= range.start.toISOString() ? 'complete' : 'partial') : history.status,
        income: totals.income, expense: totals.expense, savings: totals.savings,
        categories: [...categoryTotals].map(([name, total]) => ({ name, total })),
      };
    }
    const purchase = planningIntent(messages).purchase;
    let affordability: NonNullable<FinancialContext['planning']>['affordability'] = null;
    if (purchase && planningIntent(messages).affordability && dependencies.getAffordability) {
      try {
        const assessment = await dependencies.getAffordability({ ...purchase, itemName: 'Planned purchase' }, asOf, { summary, forecast });
        affordability = assessment.status === 'ready' ? { status: 'ready', result: assessment.result }
          : { status: assessment.status, guidance: assessment.guidance };
      } catch {
        affordability = { status: 'insufficient_information', guidance: 'Financial information could not be verified. Check Financial Planning before assessing a purchase.' };
      }
    }
    // The forecast service can append a category record ID to disambiguate labels.
    // Keep its amounts while replacing that internal suffix before serialization.
    let publicForecast = forecast;
    if (forecast.status === 'ready') {
      const reserved = new Set(Object.keys(forecast.forecast.byCategory));
      const entries = Object.entries(forecast.forecast.byCategory).map(([original, values]) => {
        let label = original;
        if (/\[category \d+\]$/.test(original)) {
          let sequence = 1;
          do { label = original.replace(/\[category \d+\]$/, `[distinct category ${sequence++}]`); } while (reserved.has(label));
          reserved.add(label);
        }
        return [label, values] as const;
      });
      publicForecast = { ...forecast, forecast: { ...forecast.forecast, byCategory: Object.fromEntries(entries) } };
    }
    const context: FinancialContext = {
      planning: { forecast: publicForecast, purchase, affordability },
      source: 'mobile_sqlite', asOf: asOf.toISOString(), timeZone: 'Asia/Karachi', history,
      forecast: { status: forecast.status, availableCompleteMonths: forecast.availableCompleteMonths, requiredCompleteMonths: 3 },
      balances: { total: summary.totalBalance, accountCount: accounts.length, basis: 'current_stored_balance' },
      current: period(currentKey, asOf), previous: period(previousKey, new Date(currentRange.start.getTime() - 1)),
    };
    return parseChatRequest({ version: 1, messages: [{ role: 'user', content: 'This month spending' }], context }).context;
  };
}
