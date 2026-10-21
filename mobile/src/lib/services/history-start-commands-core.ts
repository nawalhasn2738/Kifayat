import { and, eq, isNull } from 'drizzle-orm';
import { financialHistoryStartAudit, userProfiles } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import {
  compareFinancialHistoryStarts,
  karachiCalendarDateToFinancialHistoryStart,
  validateFinancialHistoryStartedAt,
} from '@/lib/finance/history-start';

export type ConfirmHistoryStartInput = {
  calendarDate: unknown;
};

export type CorrectHistoryStartInput = {
  calendarDate: unknown;
  expectedCurrentValue: unknown;
};

export type HistoryStartCommandRejection = {
  status: 'rejected';
  reason:
    | 'invalid_calendar_date'
    | 'future_date'
    | 'invalid_expected_value'
    | 'missing_profile'
    | 'invalid_history_start'
    | 'already_confirmed'
    | 'unconfirmed'
    | 'stale_value'
    | 'no_change'
    | 'write_failed';
};

export type ConfirmHistoryStartResult =
  | { status: 'confirmed'; value: string }
  | HistoryStartCommandRejection;

export type CorrectHistoryStartResult =
  | { status: 'corrected'; previousValue: string; value: string }
  | HistoryStartCommandRejection;

export type HistoryStartCommandDependencies = {
  userId: number;
  now: () => Date;
  afterAuditInsert?: () => void;
};

const productionDependencies: HistoryStartCommandDependencies = {
  userId: LOCAL_USER_ID,
  now: () => new Date(),
};

function proposedValue(calendarDate: unknown, now: Date) {
  if (typeof calendarDate !== 'string') {
    return { status: 'rejected', reason: 'invalid_calendar_date' } as const;
  }

  let value: string;
  try {
    value = karachiCalendarDateToFinancialHistoryStart(calendarDate);
  } catch {
    return { status: 'rejected', reason: 'invalid_calendar_date' } as const;
  }

  if (validateFinancialHistoryStartedAt(value, now).status === 'invalid') {
    return { status: 'rejected', reason: 'future_date' } as const;
  }
  return { status: 'valid', value } as const;
}

export function createHistoryStartCommandService<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: HistoryStartCommandDependencies = productionDependencies,
) {
  async function confirmHistoryStart(
    input: ConfirmHistoryStartInput,
  ): Promise<ConfirmHistoryStartResult> {
    const now = dependencies.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      return { status: 'rejected', reason: 'write_failed' };
    }
    const proposed = proposedValue(input?.calendarDate, now);
    if (proposed.status === 'rejected') return proposed;

    try {
      return database.transaction((tx) => {
        const profile = tx.select({
          financialHistoryStartedAt: userProfiles.financialHistoryStartedAt,
        }).from(userProfiles).where(eq(userProfiles.userId, dependencies.userId)).limit(1).get();
        if (!profile) return { status: 'rejected', reason: 'missing_profile' } as const;
        if (profile.financialHistoryStartedAt !== null) {
          if (validateFinancialHistoryStartedAt(profile.financialHistoryStartedAt, now).status === 'invalid') {
            return { status: 'rejected', reason: 'invalid_history_start' } as const;
          }
          return { status: 'rejected', reason: 'already_confirmed' } as const;
        }

        const updated = tx.update(userProfiles)
          .set({ financialHistoryStartedAt: proposed.value })
          .where(and(
            eq(userProfiles.userId, dependencies.userId),
            isNull(userProfiles.financialHistoryStartedAt),
          )).returning({ id: userProfiles.id }).get();
        if (!updated) return { status: 'rejected', reason: 'stale_value' } as const;

        tx.insert(financialHistoryStartAudit).values({
          userId: dependencies.userId,
          previousStartedAt: null,
          newStartedAt: proposed.value,
          changeKind: 'confirmation',
          changedAt: now.toISOString(),
        }).run();
        dependencies.afterAuditInsert?.();
        return { status: 'confirmed', value: proposed.value } as const;
      });
    } catch {
      return { status: 'rejected', reason: 'write_failed' };
    }
  }

  async function correctHistoryStart(
    input: CorrectHistoryStartInput,
  ): Promise<CorrectHistoryStartResult> {
    const now = dependencies.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      return { status: 'rejected', reason: 'write_failed' };
    }
    const proposed = proposedValue(input?.calendarDate, now);
    if (proposed.status === 'rejected') return proposed;
    const expected = validateFinancialHistoryStartedAt(input?.expectedCurrentValue, now);
    if (expected.status === 'invalid') {
      return { status: 'rejected', reason: 'invalid_expected_value' };
    }

    try {
      return database.transaction((tx) => {
        const profile = tx.select({
          financialHistoryStartedAt: userProfiles.financialHistoryStartedAt,
        }).from(userProfiles).where(eq(userProfiles.userId, dependencies.userId)).limit(1).get();
        if (!profile) return { status: 'rejected', reason: 'missing_profile' } as const;
        if (profile.financialHistoryStartedAt === null) {
          return { status: 'rejected', reason: 'unconfirmed' } as const;
        }

        const current = validateFinancialHistoryStartedAt(profile.financialHistoryStartedAt, now);
        if (current.status === 'invalid') {
          return { status: 'rejected', reason: 'invalid_history_start' } as const;
        }
        if (current.value !== expected.value) {
          return { status: 'rejected', reason: 'stale_value' } as const;
        }
        const comparison = compareFinancialHistoryStarts(current.value, proposed.value, now);
        if (comparison.status === 'invalid') {
          return { status: 'rejected', reason: 'invalid_history_start' } as const;
        }
        if (comparison.equal) return { status: 'rejected', reason: 'no_change' } as const;

        const updated = tx.update(userProfiles)
          .set({ financialHistoryStartedAt: proposed.value })
          .where(and(
            eq(userProfiles.userId, dependencies.userId),
            eq(userProfiles.financialHistoryStartedAt, expected.value),
          )).returning({ id: userProfiles.id }).get();
        if (!updated) return { status: 'rejected', reason: 'stale_value' } as const;

        tx.insert(financialHistoryStartAudit).values({
          userId: dependencies.userId,
          previousStartedAt: current.value,
          newStartedAt: proposed.value,
          changeKind: 'correction',
          changedAt: now.toISOString(),
        }).run();
        dependencies.afterAuditInsert?.();
        return {
          status: 'corrected',
          previousValue: current.value,
          value: proposed.value,
        } as const;
      });
    } catch {
      return { status: 'rejected', reason: 'write_failed' };
    }
  }

  return { confirmHistoryStart, correctHistoryStart };
}
