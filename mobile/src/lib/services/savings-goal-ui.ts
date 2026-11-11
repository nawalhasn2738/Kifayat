import { createExclusiveSubmissionGuard } from './history-workflow-ui';
export function createSavingsGoalRunner<T>(callbacks: {
  loading: (value: boolean) => void; saving: (value: boolean) => void;
  stale?: () => void; loaded: (value: T) => void; error: (value: string | null) => void; notice: (value: string | null) => void;
}) {
  const guard = createExclusiveSubmissionGuard();
  let busy = false;
  let pendingLoad: (() => Promise<T>) | null = null;
  async function load(loader: () => Promise<T>) {
    if (busy) { pendingLoad = loader; return; }
    busy = true; callbacks.loading(true); callbacks.error(null);
    try { const value = await loader(); if (!pendingLoad) callbacks.loaded(value); }
    catch { if (!pendingLoad) { callbacks.stale?.(); callbacks.error('Could not load savings planning. Try again.'); } }
    finally {
      busy = false; callbacks.loading(false);
      if (pendingLoad) { const next = pendingLoad; pendingLoad = null; await load(next); }
    }
  }
  async function submit(operation: () => Promise<unknown>, refresh: () => Promise<T>) {
    if (busy) return null;
    return guard(async () => {
      busy = true; callbacks.saving(true); callbacks.error(null); callbacks.notice(null);
      try {
        await operation();
        try { callbacks.loaded(await refresh()); callbacks.notice('Savings target saved.'); return 'saved' as const; }
        catch { callbacks.stale?.(); callbacks.notice('Target saved, but progress could not be refreshed.'); callbacks.error('Refresh savings planning before relying on the figures shown.'); return 'saved_refresh_failed' as const; }
      } catch { callbacks.error('Could not save the target. Check the values and use a unique goal name, then try again.'); return 'rejected' as const; }
      finally {
        busy = false; callbacks.saving(false);
        if (pendingLoad) { const next = pendingLoad; pendingLoad = null; await load(next); }
      }
    });
  }
  return { load, submit };
}
