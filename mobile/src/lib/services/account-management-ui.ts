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

  async function load(loader: () => Promise<T>) {
    callbacks.loading(true);
    try {
      const value = await loader();
      current = value;
      callbacks.loaded(value);
      callbacks.error(null);
      return value;
    } catch (caught) {
      callbacks.error(caught instanceof Error ? caught.message : 'Could not load accounts.');
      return null;
    } finally {
      callbacks.loading(false);
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
        const message = caught instanceof Error ? caught.message : 'Refresh failed.';
        callbacks.error(`Change saved, but accounts could not be refreshed: ${message}`);
        return { status: 'saved_refresh_failed', previous: current };
      }
    } catch (caught) {
      callbacks.error(caught instanceof Error ? caught.message : 'Could not update the account.');
      return { status: 'rejected', previous: current };
    } finally {
      active = false;
      callbacks.saving(null);
    }
  }

  return { load, submit, isActive: () => active };
}
