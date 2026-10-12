import { useCallback, useEffect, useState } from 'react';

export function useApi<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load data');
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    // Initial data loading is intentionally synchronized with the loader identity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
