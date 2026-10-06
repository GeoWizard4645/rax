import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBoard } from '../lib/rateboardClient';
import type { RbBoard } from '../../shared/rateboard';

/** The shared Rateboard board (offers, floors, house list, keep list) — refreshed every minute while visible. */
export function useRbBoard() {
  const [board, setBoard] = useState<RbBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async (fresh = false): Promise<RbBoard | null> => {
    try {
      const b = await fetchBoard(fresh);
      if (!alive.current) return b;
      setBoard(b);
      setFetchedAt(Date.now());
      setError(null);
      return b;
    } catch (e) {
      if (alive.current) setError((e as Error).message || "Couldn't reach the shared board right now.");
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 60_000);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  return { board, error, loading, fetchedAt, refresh };
}
