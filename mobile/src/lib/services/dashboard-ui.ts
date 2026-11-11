import type { Dashboard } from './dashboard-core';
export function createDashboardController(dependencies: { load: () => Promise<Dashboard>; changed: (state: DashboardState) => void }) {
  let generation = 0;
  let state: DashboardState = { data: null, loading: true, error: null };
  const publish = (patch: Partial<DashboardState>) => { state = { ...state, ...patch }; dependencies.changed(state); };
  async function refresh() {
    const request = ++generation;
    publish({ loading: true, data: null, error: null });
    try { const data = await dependencies.load(); if (request === generation) publish({ data }); }
    catch { if (request === generation) publish({ error: 'Overview could not be refreshed. Try again before relying on financial figures.' }); }
    finally { if (request === generation) publish({ loading: false }); }
  }
  return { refresh, invalidate: () => { generation++; }, getState: () => state };
}
export type DashboardState = { data: Dashboard | null; loading: boolean; error: string | null };
