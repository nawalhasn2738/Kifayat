import { createExclusiveSubmissionGuard } from './history-workflow-ui';

export function createOpeningBalanceRunner<T>(callbacks: {
  saving: (value: boolean) => void; error: (message: string | null) => void;
  loaded: (value: T) => void; savedButStale: (message: string) => void;
}) {
  const guard = createExclusiveSubmissionGuard();
  let current: T | null = null;
  async function load(loader: () => Promise<T>) {
    try { const value = await loader(); current = value; callbacks.loaded(value); callbacks.error(null); return value; }
    catch (caught) { callbacks.error(caught instanceof Error ? caught.message : 'Could not load opening balances.'); return null; }
  }
  async function submit(operation: () => Promise<unknown>, refresh: () => Promise<T>) {
    return guard(async () => {
      callbacks.saving(true); callbacks.error(null);
      try {
        await operation();
        try { const value = await refresh(); current = value; callbacks.loaded(value); return { status: 'saved' as const, value }; }
        catch (caught) { const message = caught instanceof Error ? caught.message : 'Refresh failed.'; callbacks.savedButStale(message); return { status: 'saved_refresh_failed' as const, previous: current }; }
      } catch (caught) { callbacks.error(caught instanceof Error ? caught.message : 'Could not save opening balance.'); return { status: 'rejected' as const, previous: current }; }
      finally { callbacks.saving(false); }
    });
  }
  return { load, submit };
}
