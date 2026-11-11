import { eq } from 'drizzle-orm';
import { userProfiles, transactions } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import {
  financialHistoryStartToKarachiCalendarDate,
  karachiCalendarDateToFinancialHistoryStart,
  validateFinancialHistoryStartedAt,
} from '@/lib/finance/history-start';
import { reportingCalendarDate } from '@/lib/finance/reporting-calendar';
import { isValidTransactionDate } from '@/lib/validation/transaction';

export const HISTORY_START_UNCONFIRMED_REASON = 'history_start_unconfirmed' as const;

export type HistoryStartSuggestion = {
  value: string;
  calendarDate: string;
  sourceTransactionDate: string;
};

export type FinancialHistoryState =
  | { status: 'confirmed'; value: string; calendarDate: string }
  | {
    status: 'unconfirmed';
    reason: typeof HISTORY_START_UNCONFIRMED_REASON;
    suggestion: HistoryStartSuggestion | null;
  }
  | { status: 'invalid'; reason: 'invalid_history_start' }
  | { status: 'missing_profile' }
  | { status: 'transaction_history_invalid' };

export type HistoryStartStateDependencies = {
  userId: number;
  now: () => Date;
};

const productionDependencies: HistoryStartStateDependencies = {
  userId: LOCAL_USER_ID,
  now: () => new Date(),
};

export function createHistoryStartStateService<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: HistoryStartStateDependencies = productionDependencies,
) {
  async function getFinancialHistoryState(): Promise<FinancialHistoryState> {
    const [profile] = await database.select({
      financialHistoryStartedAt: userProfiles.financialHistoryStartedAt,
    }).from(userProfiles).where(eq(userProfiles.userId, dependencies.userId)).limit(1);

    if (!profile) return { status: 'missing_profile' };

    const now = dependencies.now();
    if (profile.financialHistoryStartedAt !== null) {
      const display = financialHistoryStartToKarachiCalendarDate(
        profile.financialHistoryStartedAt,
        now,
      );
      if (display.status === 'invalid') return display;
      return {
        status: 'confirmed',
        value: display.value,
        calendarDate: display.calendarDate,
      };
    }

    const transactionDates = await database.select({ date: transactions.date })
      .from(transactions).where(eq(transactions.userId, dependencies.userId));
    let earliest: string | null = null;
    for (const row of transactionDates) {
      if (!isValidTransactionDate(row.date)) return { status: 'transaction_history_invalid' };
      if (earliest === null || row.date < earliest) earliest = row.date;
    }

    if (earliest === null) {
      return {
        status: 'unconfirmed',
        reason: HISTORY_START_UNCONFIRMED_REASON,
        suggestion: null,
      };
    }

    const calendarDate = reportingCalendarDate(earliest);
    const suggestedValue = karachiCalendarDateToFinancialHistoryStart(calendarDate);
    if (validateFinancialHistoryStartedAt(suggestedValue, now).status === 'invalid') {
      return { status: 'transaction_history_invalid' };
    }

    return {
      status: 'unconfirmed',
      reason: HISTORY_START_UNCONFIRMED_REASON,
      suggestion: {
        value: suggestedValue,
        calendarDate,
        sourceTransactionDate: earliest,
      },
    };
  }

  return { getFinancialHistoryState };
}
