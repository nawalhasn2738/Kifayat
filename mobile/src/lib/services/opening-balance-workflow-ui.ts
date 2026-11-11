import { createExclusiveSubmissionGuard } from './history-workflow-ui';
import { userFacingError } from './user-facing-error';
export function createOpeningBalanceRunner<T>(callbacks: {
  saving: (value: boolean) => void; error: (message: string | null) => void;
  loaded: (value: T) => void; savedButStale: (message: string) => void;
}) {
  const guard = createExclusiveSubmissionGuard();
  let current: T | null = null, generation = 0, writing = false;
  let pending: (() => Promise<T>) | null = null;
  async function load(loader: () => Promise<T>): Promise<T | null> {
    if (writing) { pending = loader; return null; }
    const request = ++generation;
    try {
      const value = await loader();
      if (request !== generation) return null;
      current = value; callbacks.loaded(value); callbacks.error(null); return value;
    } catch (error) { if (request === generation) callbacks.error(userFacingError(error, 'Could not load opening balances.')); return null; }
  }
  async function submit(operation: () => Promise<unknown>, refresh: () => Promise<T>) {
    return guard(async () => {
      const request = ++generation; writing = true;
      callbacks.saving(true); callbacks.error(null);
      try {
        await operation();
        try {
          const value = await refresh();
          if (request !== generation) return { status: 'saved_refresh_failed' as const, previous: current };
          current = value; callbacks.loaded(value); return { status: 'saved' as const, value };
        } catch (error) {
          if (request === generation) callbacks.savedButStale(userFacingError(error, 'Refresh failed.'));
          return { status: 'saved_refresh_failed' as const, previous: current };
        }
      } catch (error) {
        if (request === generation) callbacks.error(userFacingError(error, 'Could not save opening balance.'));
        return { status: 'rejected' as const, previous: current };
      } finally {
        writing = false; callbacks.saving(false);
        if (pending) { const next = pending; pending = null; await load(next); }
      }
    });
  }
  function invalidate() { generation++; pending = null; }
  return { load, submit, invalidate };
}
