import { reportingMonthKey, reportingMonthRange } from '@/lib/finance/reporting-calendar';
import { createSummaryService, transactionsAtOrBefore } from '@/lib/services/finance-core';
import { parseChatRequest, type FinancialContext, type Period } from '../chat/contract';
import type { FinancialHistoryState } from './history-start-state-core';
import type { ForecastResult, Transaction } from '@/lib/types';

type ContextAccount = { id: number; name: string; type: string; balance: number };
export type ChatContextDependencies = {
  listAccounts: () => Promise<ContextAccount[]>;
  listAllTransactions: () => Promise<Transaction[]>;
  getHistory: () => Promise<FinancialHistoryState>;
  getForecast: (asOf: Date) => Promise<ForecastResult>;
  now: () => Date;
};

export function createChatContextProvider(dependencies: ChatContextDependencies) {
  return async function getChatContext(): Promise<FinancialContext> {
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
    const context: FinancialContext = {
      source: 'mobile_sqlite', asOf: asOf.toISOString(), timeZone: 'Asia/Karachi', history,
      forecast: { status: forecast.status, availableCompleteMonths: forecast.availableCompleteMonths, requiredCompleteMonths: 3 },
      balances: { total: summary.totalBalance, accountCount: accounts.length, basis: 'current_stored_balance' },
      current: period(currentKey, asOf), previous: period(previousKey, new Date(currentRange.start.getTime() - 1)),
    };
    return parseChatRequest({ version: 1, messages: [{ role: 'user', content: 'This month spending' }], context }).context;
  };
}
