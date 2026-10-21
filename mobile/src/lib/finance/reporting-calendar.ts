import { isValidTransactionDate } from '@/lib/validation/transaction';

export const REPORTING_TIME_ZONE = 'Asia/Karachi';

export type ReportingMonthRange = {
  month: string;
  start: Date;
  endExclusive: Date;
};

const invalidDateError = 'Enter a valid date.';
const invalidCalendarDateError = 'Enter a valid Karachi calendar date in YYYY-MM-DD format.';
const invalidMonthError = 'Enter a valid reporting month in YYYY-MM format.';
const calendarDatePattern = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const monthKeyPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

const reportingPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function requireValidInstant(value: Date | string): Date {
  if (typeof value === 'string') {
    if (!isValidTransactionDate(value)) throw new Error(invalidDateError);
    return new Date(value);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(invalidDateError);
  return new Date(value.getTime());
}

function requireValidMonthKey(monthKey: string) {
  const match = monthKeyPattern.exec(monthKey);
  if (!match || Number(match[1]) === 0) throw new Error(invalidMonthError);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function requireValidCalendarDate(calendarDate: string) {
  const match = calendarDatePattern.exec(calendarDate);
  if (!match || Number(match[1]) === 0) throw new Error(invalidCalendarDateError);

  const canonicalUtcDate = new Date(`${calendarDate}T00:00:00.000Z`);
  if (Number.isNaN(canonicalUtcDate.getTime()) || canonicalUtcDate.toISOString().slice(0, 10) !== calendarDate) {
    throw new Error(invalidCalendarDateError);
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function localParts(instant: Date) {
  const values: Record<string, string> = {};
  for (const part of reportingPartsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function utcEpoch(parts: ReturnType<typeof localParts>) {
  const iso = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    + `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}.000Z`;
  return Date.parse(iso);
}

function startOfReportingDateInstant(year: number, month: number, day: number) {
  const target = { year, month, day, hour: 0, minute: 0, second: 0 };
  const targetEpoch = utcEpoch(target);
  let candidateEpoch = targetEpoch;

  // Resolve local midnight through the IANA timezone database rather than a fixed offset.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const difference = targetEpoch - utcEpoch(localParts(new Date(candidateEpoch)));
    if (difference === 0) return new Date(candidateEpoch);
    candidateEpoch += difference;
  }

  throw new Error(`Could not resolve reporting month boundary in ${REPORTING_TIME_ZONE}.`);
}

function followingMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function reportingMonthKey(instant: Date | string) {
  const parts = localParts(requireValidInstant(instant));
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
}

export function reportingCalendarDate(instant: Date | string) {
  const parts = localParts(requireValidInstant(instant));
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function reportingCalendarDateStart(calendarDate: string) {
  const { year, month, day } = requireValidCalendarDate(calendarDate);
  return startOfReportingDateInstant(year, month, day);
}

export function reportingMonthStart(monthKey: string) {
  const { year, month } = requireValidMonthKey(monthKey);
  return startOfReportingDateInstant(year, month, 1);
}

export function nextReportingMonthStart(monthKey: string) {
  const current = requireValidMonthKey(monthKey);
  const next = followingMonth(current.year, current.month);
  return startOfReportingDateInstant(next.year, next.month, 1);
}

export function reportingMonthRange(monthKey: string): ReportingMonthRange {
  return {
    month: monthKey,
    start: reportingMonthStart(monthKey),
    endExclusive: nextReportingMonthStart(monthKey),
  };
}
