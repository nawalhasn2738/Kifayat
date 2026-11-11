import { userFacingError } from './user-facing-error';
export function createResourceLoader<T>(callbacks: {
  loading: (value: boolean) => void; loaded: (value: T | null) => void; error: (value: string | null) => void;
}) {
  let generation = 0;
  async function load(loader: () => Promise<T>) {
    const request = ++generation; callbacks.loading(true); callbacks.error(null);
    try { const value = await loader(); if (request === generation) callbacks.loaded(value); }
    catch (error) { if (request === generation) { callbacks.loaded(null); callbacks.error(userFacingError(error, 'Local data could not be loaded safely. Try again.')); } }
    finally { if (request === generation) callbacks.loading(false); }
  }
  return { load, invalidate: () => { generation++; } };
}
