import { useCallback, useEffect, useRef, useState } from 'react';
import type { OddsResponse, OddsSport } from '../../shared/odds';
import { getJson } from '../lib/api';

export interface SportOdds {
  data: OddsResponse | null;
  error: string | null;
  loading: boolean;
  /** Client time (ms) of the last successful fetch. */
  fetchedAt: number | null;
}

const EMPTY: SportOdds = { data: null, error: null, loading: false, fetchedAt: null };

/** Module-level cache: switching sports or tabs shows the last response instantly, then refreshes behind it. */
const cache = new Map<OddsSport, { data: OddsResponse; fetchedAt: number }>();

const snapshot = (sports: OddsSport[], prev: Record<string, SportOdds> = {}): Record<string, SportOdds> => {
  const out: Record<string, SportOdds> = { ...prev };
  for (const sp of sports) {
    const c = cache.get(sp);
    if (!out[sp]) out[sp] = c ? { data: c.data, error: null, loading: false, fetchedAt: c.fetchedAt } : EMPTY;
  }
  return out;
};

/**
 * Live odds per sport from `GET /api/odds/events?sport=X` — ALWAYS one call per sport (an `ALL` call can exceed the free-tier CPU
 * limit when cold). `sports` is the active sport plus any sport that has saved Real % entries (for the Best-EV board); they are
 * fetched one after another, active first.
 *
 * Auto-refresh: every `intervalMs` while the page is visible; paused while hidden, and refreshed as soon as it is visible again
 * if the data is older than the interval. The server caches 45 s, so a 60 s cadence costs one upstream fan-out per minute.
 */
export function useOdds(sports: OddsSport[], active: OddsSport, opts: { enabled?: boolean; intervalMs?: number } = {}) {
  const { enabled = true, intervalMs = 60_000 } = opts;
  const [state, setState] = useState<Record<string, SportOdds>>(() => snapshot(sports));
  const inflight = useRef(new Map<OddsSport, AbortController>());
  const alive = useRef(true);
  const sportsKey = [...new Set(sports)].sort().join(',');

  useEffect(() => {
    alive.current = true;
    const flights = inflight.current;
    return () => {
      alive.current = false;
      flights.forEach((c) => c.abort());
      flights.clear();
    };
  }, []);

  const patch = useCallback((sp: OddsSport, p: Partial<SportOdds>) => {
    if (alive.current) setState((s) => ({ ...s, [sp]: { ...(s[sp] ?? EMPTY), ...p } }));
  }, []);

  const fetchOne = useCallback(
    async (sp: OddsSport) => {
      if (inflight.current.has(sp)) return;
      const ctl = new AbortController();
      inflight.current.set(sp, ctl);
      patch(sp, { loading: true });
      try {
        const data = await getJson<OddsResponse>(`/api/odds/events?sport=${sp}`, ctl.signal);
        const fetchedAt = Date.now();
        cache.set(sp, { data, fetchedAt });
        patch(sp, { data, error: null, loading: false, fetchedAt });
      } catch (e) {
        if (ctl.signal.aborted || (e as Error).name === 'AbortError') return;
        const status = (e as { status?: number }).status;
        const unreachable = status === 502 || status === 503 || status === 504 || status === 0;
        const msg = unreachable
          ? `The odds service isn't reachable (${status || 'network'}). ${import.meta.env.DEV ? 'Running locally? Start the Functions server with "npm run dev:full" (or "npm run pages:dev" in a second terminal).' : 'Try again in a moment.'}`
          : (e as Error).message || 'Could not load odds.';
        patch(sp, { error: msg, loading: false }); // keep the last good data on screen
      } finally {
        if (inflight.current.get(sp) === ctl) inflight.current.delete(sp);
      }
    },
    [patch],
  );

  // Refresh pass: active sport first, then the rest, skipping anything fresher than `staleMs`. Sequential on purpose (Kalshi rate limit).
  const pass = useCallback(
    async (staleMs: number) => {
      const list = sportsKey ? (sportsKey.split(',') as OddsSport[]) : [];
      const order = [active, ...list.filter((s) => s !== active)];
      for (const sp of order) {
        const c = cache.get(sp);
        // Hidden tab: never refresh data we already have, but do the first load so the tab isn't empty when revealed.
        if (!alive.current || (document.visibilityState !== 'visible' && c)) return;
        if (c && Date.now() - c.fetchedAt < staleMs) continue;
        await fetchOne(sp);
      }
    },
    [active, sportsKey, fetchOne],
  );

  useEffect(() => {
    setState((s) => snapshot([active, ...(sportsKey ? (sportsKey.split(',') as OddsSport[]) : [])], s));
    if (!enabled) return;
    void pass(30_000);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void pass(intervalMs - 5_000);
    }, intervalMs);
    const onVis = () => {
      if (document.visibilityState === 'visible') void pass(intervalMs - 5_000);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, intervalMs, pass, active, sportsKey]);

  /** Force a refresh of one sport now (ignores freshness). */
  const reload = useCallback((sp: OddsSport) => void fetchOne(sp), [fetchOne]);

  return { bySport: state, reload };
}

/** Re-render every `ms` so "updated 23 s ago" stays true. */
export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
