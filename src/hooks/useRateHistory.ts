import { useEffect } from 'react';
import { getJson } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import type { RateCoverage } from '../types/market';

export interface RatesStatus {
  source: 'rateboard';
  generatedAt: string;
  coverage: RateCoverage;
  sampled: boolean;
  wroteKv: boolean;
  skipped: 'upstream' | 'implausible' | null;
  board: { offers: number; buyers: number; players: number } | null;
  /** 7-day median bid rate per player key — empty until ≥ 3 days of history exist. */
  baselines: Record<string, number>;
  note: string;
}

/**
 * Recorder status + history baselines. Calling it also nudges the edge to take a fresh sample (it is the same endpoint
 * the GitHub Actions cron pings), re-checked every 5 minutes while the page is open.
 */
export function useRateHistory(enabled = true) {
  const st = useAsync<RatesStatus>((signal) => getJson('/api/market/rates', signal), [], enabled);
  const { reload } = st;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => document.visibilityState === 'visible' && reload(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [enabled, reload]);
  return st;
}
