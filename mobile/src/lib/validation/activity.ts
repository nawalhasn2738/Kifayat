import { and, eq, lt, lte, or, sql, type AnyColumn } from 'drizzle-orm';
import { isValidTransactionDate } from './transaction';
import { reportingCalendarDateStart, reportingMonthRange } from '../finance/reporting-calendar';

export type ActivityFilters = { type: 'all' | 'income' | 'expense' | 'transfer'; categoryId?: number | null; accountId?: number; start?: string; endExclusive?: string; search?: string };
export type ActivityCursor = { date: string; kind: 'transaction' | 'transfer'; id: number; filterKey: string };
export type ActivityQuery = { filters?: ActivityFilters; cursor?: ActivityCursor | null; pageSize?: number };
export const emptyActivityFilters: ActivityFilters = { type: 'all' };
export function normalizeActivityFilters(input: ActivityFilters = emptyActivityFilters): ActivityFilters {
  if (!input || !['all', 'income', 'expense', 'transfer'].includes(input.type)) throw new Error('Invalid activity type.');
  for (const id of [input.accountId, input.categoryId]) if (id !== undefined && id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid activity selection.');
  if (input.accountId === null) throw new Error('Invalid account selection.');
  for (const date of [input.start, input.endExclusive]) if (date !== undefined && !isValidTransactionDate(date)) throw new Error('Invalid activity date.');
  if (input.start && input.endExclusive && input.start >= input.endExclusive) throw new Error('The end date must be after the start date.');
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) throw new Error('Search must be at most 200 characters.');
  return { type: input.type, ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.accountId !== undefined ? { accountId: input.accountId } : {}), ...(input.start ? { start: input.start } : {}),
    ...(input.endExclusive ? { endExclusive: input.endExclusive } : {}), ...(input.search?.trim() ? { search: input.search.trim() } : {}) };
}
export const activityFilterKey = (filters: ActivityFilters) => JSON.stringify(normalizeActivityFilters(filters));
export function validateActivityQuery(query: ActivityQuery = {}) {
  const filters = normalizeActivityFilters(query.filters), pageSize = query.pageSize ?? 50, cursor = query.cursor ?? null;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Activity pages must contain 1 to 100 events.');
  if (cursor && (!isValidTransactionDate(cursor.date) || !['transaction', 'transfer'].includes(cursor.kind) || !Number.isSafeInteger(cursor.id) || cursor.id <= 0 || cursor.filterKey !== activityFilterKey(filters))) throw new Error('Activity cursor does not match these filters.');
  return { filters, pageSize, cursor };
}
export function activityCursorCondition(date: AnyColumn, id: AnyColumn, cursor: ActivityCursor | null, kind: ActivityCursor['kind']) {
  if (!cursor) return undefined;
  if (kind === cursor.kind) return or(lt(date, cursor.date), and(eq(date, cursor.date), lt(id, cursor.id)));
  return kind === 'transaction' ? lte(date, cursor.date) : lt(date, cursor.date);
}
export function activitySearch(columns: AnyColumn[], search?: string) {
  if (!search) return undefined;
  const pattern = '%' + search.replace(/[\\%_]/g, value => '\\' + value) + '%';
  return or(...columns.map(column => sql`${column} LIKE ${pattern} ESCAPE ${'\\'}`));
}
export function activityDateRange(mode: 'all' | 'month' | 'range', month: string, from: string, before: string) {
  if (mode === 'all') return {};
  if (mode === 'month') { const range = reportingMonthRange(month); return { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString() }; }
  if (!from && !before) throw new Error('Enter a start date or an exclusive end date.');
  const filters = normalizeActivityFilters({ type: 'all', ...(from ? { start: reportingCalendarDateStart(from).toISOString() } : {}), ...(before ? { endExclusive: reportingCalendarDateStart(before).toISOString() } : {}) });
  return { start: filters.start, endExclusive: filters.endExclusive };
}
