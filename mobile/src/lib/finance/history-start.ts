import {
  reportingCalendarDate,
  reportingCalendarDateStart,
} from '@/lib/finance/reporting-calendar';
import { isValidTransactionDate } from '@/lib/validation/transaction';

export const INVALID_HISTORY_START_REASON = 'invalid_history_start' as const;

export type InvalidHistoryStart = {
  status: 'invalid';
  reason: typeof INVALID_HISTORY_START_REASON;
};

export type ValidHistoryStart = {
  status: 'valid';
  value: string;
  instant: Date;
};

export type HistoryStartValidationResult = ValidHistoryStart | InvalidHistoryStart;

const invalidHistoryStart: InvalidHistoryStart = {
  status: 'invalid',
  reason: INVALID_HISTORY_START_REASON,
};

function requireValidReferenceTime(now: Date) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('History-start validation requires a valid reference time.');
  }
  return now.getTime();
}

/** Validates persisted history-start data without normalizing or repairing it. */
export function validateFinancialHistoryStartedAt(
  value: unknown,
  now: Date,
): HistoryStartValidationResult {
  const currentTime = requireValidReferenceTime(now);
  if (typeof value !== 'string' || !isValidTransactionDate(value)) return invalidHistoryStart;

  const instant = new Date(value);
  if (instant.getTime() > currentTime) return invalidHistoryStart;

  return { status: 'valid', value, instant };
}

/** Converts a user-selected Karachi calendar date to its canonical UTC storage instant. */
export function karachiCalendarDateToFinancialHistoryStart(calendarDate: string) {
  return reportingCalendarDateStart(calendarDate).toISOString();
}

/** Converts a validated persisted value to its Karachi calendar date for display. */
export function financialHistoryStartToKarachiCalendarDate(
  value: unknown,
  now: Date,
): InvalidHistoryStart | (ValidHistoryStart & { calendarDate: string }) {
  const validated = validateFinancialHistoryStartedAt(value, now);
  if (validated.status === 'invalid') return validated;

  return {
    ...validated,
    calendarDate: reportingCalendarDate(validated.instant),
  };
}

/** Compares only strictly validated canonical values for correction no-op detection. */
export function compareFinancialHistoryStarts(
  left: unknown,
  right: unknown,
  now: Date,
): InvalidHistoryStart | { status: 'valid'; equal: boolean } {
  const validatedLeft = validateFinancialHistoryStartedAt(left, now);
  if (validatedLeft.status === 'invalid') return validatedLeft;

  const validatedRight = validateFinancialHistoryStartedAt(right, now);
  if (validatedRight.status === 'invalid') return validatedRight;

  return { status: 'valid', equal: validatedLeft.value === validatedRight.value };
}
