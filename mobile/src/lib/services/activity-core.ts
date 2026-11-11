import type { Transaction } from '../types';
import type { Transfer } from '../repositories/transfers-core';
import { validateActivityQuery, activityFilterKey, type ActivityQuery, type ActivityCursor } from '../validation/activity';
export type ActivityItem = (Transaction & { kind: 'transaction' }) | (Transfer & { kind: 'transfer' });
export type ActivityPage = { items: ActivityItem[]; nextCursor: ActivityCursor | null; pageSize: number };
export function compareActivity(left: Pick<ActivityItem, 'date' | 'id' | 'kind'>, right: Pick<ActivityItem, 'date' | 'id' | 'kind'>) {
  return right.date.localeCompare(left.date) || (left.kind === right.kind ? right.id - left.id : left.kind === 'transfer' ? -1 : 1);
}
export function createActivityService(dependencies: {
  listTransactionActivity: (query: ActivityQuery) => Promise<Transaction[]>;
  listTransferActivity: (query: ActivityQuery) => Promise<Transfer[]>;
}) {
  return async function getActivity(query: ActivityQuery = {}): Promise<ActivityPage> {
    const normalized = validateActivityQuery(query);
    const [transactions, transfers] = await Promise.all([dependencies.listTransactionActivity(normalized), dependencies.listTransferActivity(normalized)]);
    const merged: ActivityItem[] = [...transactions.map(item => ({ ...item, kind: 'transaction' as const })), ...transfers.map(item => ({ ...item, kind: 'transfer' as const }))].sort(compareActivity);
    const items = merged.slice(0, normalized.pageSize), last = items.at(-1);
    return { items, pageSize: normalized.pageSize, nextCursor: merged.length > items.length && last
      ? { date: last.date, id: last.id, kind: last.kind, filterKey: activityFilterKey(normalized.filters) } : null };
  };
}
