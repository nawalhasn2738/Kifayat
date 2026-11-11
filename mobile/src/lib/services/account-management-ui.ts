import { userFacingError } from './user-facing-error';
export type AccountManagementResult<T> =
  | { status: 'saved'; value: T }
  | { status: 'saved_refresh_failed'; previous: T | null }
  | { status: 'rejected'; previous: T | null };

export function createAccountManagementRunner<T>(callbacks: {
  loading: (value: boolean) => void;
  saving: (key: string | null) => void;
  loaded: (value: T) => void;
  error: (message: string | null) => void;
  notice: (message: string | null) => void;
}) {
  let current: T | null = null;
  let active = false;
  let generation = 0;
  let pendingLoad: (() => Promise<T>) | null = null;

  async function load(loader: () => Promise<T>): Promise<T | null> {
    if (active) { pendingLoad = loader; return null; }
    const request = ++generation;
    callbacks.loading(true);
    try {
      const value = await loader();
      if (request !== generation) return null;
      current = value;
      callbacks.loaded(value);
      callbacks.error(null);
      return value;
    } catch (caught) {
      if (request === generation) callbacks.error(userFacingError(caught, 'Could not load accounts.'));
      return null;
    } finally {
      if (request === generation) callbacks.loading(false);
    }
  }

  async function submit(
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
    refresh: () => Promise<T>,
  ): Promise<AccountManagementResult<T> | null> {
    if (active) return null;
    active = true;
    generation++; callbacks.loading(false);
    callbacks.saving(key);
    callbacks.error(null);
    callbacks.notice(null);
    try {
      await operation();
      try {
        const value = await refresh();
        current = value;
        callbacks.loaded(value);
        callbacks.notice(successMessage);
        return { status: 'saved', value };
      } catch (caught) {
        const message = userFacingError(caught, 'Refresh failed.');
        callbacks.error(`Change saved, but accounts could not be refreshed: ${message}`);
        return { status: 'saved_refresh_failed', previous: current };
      }
    } catch (caught) {
      callbacks.error(userFacingError(caught, 'Could not update the account.'));
      return { status: 'rejected', previous: current };
    } finally {
      active = false;
      callbacks.saving(null);
      if (pendingLoad) { const next = pendingLoad; pendingLoad = null; await load(next); }
    }
  }

  return { load, submit, isActive: () => active };
}
