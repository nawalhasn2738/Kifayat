import { createResourceLoader } from '@/lib/services/resource-loader-core';
import { useCallback, useEffect, useState } from 'react';

export function useApi<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [controller] = useState(() => createResourceLoader<T>({ loading: setLoading, loaded: setData, error: setError }));
  const reload = useCallback(() => controller.load(loader), [loader, controller]);

  useEffect(() => {
    // Initial data loading is intentionally synchronized with the loader identity.
    void reload();
    return controller.invalidate;
  }, [reload, controller]);

  return { data, loading, error, reload };
}
