import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Run an async loader when `deps` change. Stale responses are ignored, and `reload()` re-runs it.
 * Pass `enabled: false` to hold off (e.g. until a username is entered).
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    loaderRef
      .current(ctl.signal)
      .then((d) => {
        if (!ctl.signal.aborted) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (ctl.signal.aborted || e.name === 'AbortError') return;
        setError(e.message || 'Something went wrong.');
        setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
