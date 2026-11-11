import type { ActivityItem, ActivityPage } from './activity-core';
import { normalizeActivityFilters, type ActivityCursor, type ActivityFilters, type ActivityQuery } from '../validation/activity';
export type ActivityBrowserState = {
  filters: ActivityFilters; items: ActivityItem[]; pageIndex: number; nextCursor: ActivityCursor | null;
  loading: boolean; error: string | null;
};
export const initialActivityBrowserState: ActivityBrowserState = { filters: { type: 'all' }, items: [], pageIndex: 0, nextCursor: null, loading: false, error: null };
export function createActivityBrowser(dependencies: { fetchPage: (query: ActivityQuery) => Promise<ActivityPage>; changed: (state: ActivityBrowserState) => void }) {
  let state = { ...initialActivityBrowserState };
  let generation = 0;
  let starts: (ActivityCursor | null)[] = [null];
  let retry: (() => Promise<void>) | null = null;
  const publish = (patch: Partial<ActivityBrowserState>) => { state = { ...state, ...patch }; dependencies.changed(state); };
  async function read(cursor: ActivityCursor | null, pageIndex: number) {
    const request = ++generation, filters = { ...state.filters };
    publish({ loading: true, error: null });
    try {
      const page = await dependencies.fetchPage({ filters, cursor, pageSize: 50 });
      if (request !== generation) return;
      const keys = page.items.map(item => `${item.kind}:${item.id}`);
      if (page.items.length > 50 || new Set(keys).size !== keys.length) throw new Error('Invalid activity page.');
      starts = [...starts.slice(0, pageIndex), cursor];
      retry = null;
      publish({ items: page.items, pageIndex, nextCursor: page.nextCursor });
    } catch {
      if (request !== generation) return;
      retry = () => read(cursor, pageIndex);
      publish({ error: 'Could not load activity. Your filters are preserved; try again.' });
    } finally { if (request === generation) publish({ loading: false }); }
  }
  async function apply(filters: ActivityFilters) {
    const valid = normalizeActivityFilters(filters);
    starts = [null]; retry = null;
    publish({ filters: valid, items: [], pageIndex: 0, nextCursor: null });
    await read(null, 0);
  }
  const refresh = () => apply(state.filters);
  async function next() {
    if (state.loading || !state.nextCursor || state.error) return;
    await read(state.nextCursor, state.pageIndex + 1);
  }
  async function previous() {
    if (state.loading || state.pageIndex === 0) return;
    await read(starts[state.pageIndex - 1], state.pageIndex - 1);
  }
  function invalidate() { generation++; retry = null; publish({ loading: false }); }
  return { apply, refresh, next, previous, retry: async () => { if (!state.loading && retry) await retry(); }, invalidate, getState: () => state };
}
