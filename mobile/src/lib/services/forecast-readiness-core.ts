import { reportingMonthKey, reportingMonthStart } from '@/lib/finance/reporting-calendar';
import { calculateForecast } from '@/lib/services/finance-core';
import type { FinancialHistoryState } from '@/lib/services/history-start-state-core';
import type { ForecastResult, Transaction } from '@/lib/types';
import { isValidTransactionDate } from '@/lib/validation/transaction';

export type ForecastReadinessDependencies = {
  getFinancialHistoryState: () => Promise<FinancialHistoryState>;
  listAllTransactions: () => Promise<Transaction[]>;
  now: () => Date;
};

const REQUIRED_COMPLETE_MONTHS = 3 as const;

function previousMonth(month: string) {
  return reportingMonthKey(new Date(reportingMonthStart(month).getTime() - 1));
}

function precedingMonths(asOf: Date) {
  const months: string[] = [];
  let month = reportingMonthKey(asOf);
  for (let index = 0; index < REQUIRED_COMPLETE_MONTHS; index += 1) {
    month = previousMonth(month);
    months.unshift(month);
  }
  return months;
}

function unavailable(
  reason: 'history_start_unconfirmed' | 'invalid_history_start',
  guidance: string,
): ForecastResult {
  return {
    status: 'insufficient_history',
    forecast: null,
    reason,
    requiredCompleteMonths: REQUIRED_COMPLETE_MONTHS,
    availableCompleteMonths: 0,
    qualifyingMonths: [],
    guidance,
  };
}

export function createForecastReadinessService(dependencies: ForecastReadinessDependencies) {
  return async function getForecast(asOf = dependencies.now()): Promise<ForecastResult> {
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      return unavailable('invalid_history_start', 'Forecast readiness could not be evaluated safely.');
    }

    let history: FinancialHistoryState;
    try {
      history = await dependencies.getFinancialHistoryState();
    } catch {
      return unavailable(
        'invalid_history_start',
        'Financial history needs attention before a forecast can be prepared.',
      );
    }
    if (history.status === 'unconfirmed') {
      return unavailable(
        'history_start_unconfirmed',
        'Confirm when your complete financial history begins to start forecast readiness.',
      );
    }
    if (history.status !== 'confirmed') {
      return unavailable(
        'invalid_history_start',
        'Financial history needs attention before a forecast can be prepared.',
      );
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.listAllTransactions();
    } catch {
      return unavailable(
        'invalid_history_start',
        'Transaction history needs attention before a forecast can be prepared.',
      );
    }
    if (transactions.some((transaction) => !isValidTransactionDate(transaction.date))) {
      return unavailable(
        'invalid_history_start',
        'Transaction history needs attention before a forecast can be prepared.',
      );
    }

    const requiredMonths = precedingMonths(asOf);
    const qualifyingMonths = requiredMonths.filter(
      (month) => reportingMonthStart(month).getTime() >= new Date(history.value).getTime(),
    );
    if (qualifyingMonths.length < REQUIRED_COMPLETE_MONTHS) {
      return {
        status: 'insufficient_history',
        forecast: null,
        reason: 'insufficient_complete_months',
        requiredCompleteMonths: REQUIRED_COMPLETE_MONTHS,
        availableCompleteMonths: qualifyingMonths.length,
        qualifyingMonths,
        guidance: `${qualifyingMonths.length} of ${REQUIRED_COMPLETE_MONTHS} complete reporting months are available.`,
      };
    }

    return {
      status: 'ready',
      forecast: calculateForecast(transactions, asOf, requiredMonths),
      requiredCompleteMonths: REQUIRED_COMPLETE_MONTHS,
      availableCompleteMonths: REQUIRED_COMPLETE_MONTHS,
      qualifyingMonths: requiredMonths,
      guidance: 'Three complete reporting months are available.',
    };
  };
}
