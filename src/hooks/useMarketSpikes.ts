import { useMemo } from 'react';
import { getJson } from '../lib/api';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { loadSnapshot } from '../lib/snapshots';
import { bidsToSeries } from '../../shared/historyCore';
import { buildCandles } from '../../shared/formulas';
import { buildForecastInputs, summarizeMarket } from '../../shared/market';
import type { CandlesResponse, ForecastInputs, SpikesResponse } from '../types/market';
import type { Sport } from '../types/real';
import type { SourceId } from '../components/ui/SourceSelect';

type Win = '24h' | '7d' | '30d';
/** Sports that can be filtered per source: Rateboard lists FC (soccer) and not NBA/MLB/CBB/PGA; card feeds are the reverse. */
export type MarketSportFilter = Sport | 'FC' | 'ALL';

const sportQs = (sport: MarketSportFilter) => (sport === 'ALL' ? '' : `&sport=${sport}`);
const done = <T,>(data: T | null, error: string | null = null): AsyncState<T> => ({ data, error, loading: false, reload: () => {} });

/** Series built in the browser from the snapshot the user imported in Tab 2 (never uploaded). */
function useImportedSeries(enabled: boolean) {
  return useMemo(() => {
    if (!enabled) return null;
    const snap = loadSnapshot();
    return snap ? { snap, series: bidsToSeries(snap.bids, snap.t) } : null;
  }, [enabled]);
}

export function useMarketSpikes(sport: MarketSportFilter, source: SourceId): AsyncState<SpikesResponse> {
  const imp = useImportedSeries(source === 'imported');
  const remote = useAsync<SpikesResponse>(
    (signal) => getJson(`/api/market/spikes?source=${source === 'rateboard' ? 'rateboard' : 'sample'}${sportQs(sport)}`, signal),
    [sport, source],
    source !== 'imported',
  );
  const local = useMemo(() => {
    if (!imp) return null;
    const scoped = sport === 'ALL' ? imp.series : imp.series.filter((s) => s.sport === sport);
    const out = summarizeMarket(scoped, imp.snap.t, {}, 'imported');
    out.note = 'Built in your browser from the auctions you imported in Tab 2. A single import covers a short window, so spikes (which need a 7-day baseline) are rare; candles and fair value use whatever the snapshot contains.';
    return out;
  }, [imp, sport]);
  if (source === 'imported') return done(local, imp ? null : 'Nothing imported yet — import auctions in Tab 2 first.');
  return remote;
}

export function useCandles(key: string | null, window: Win, source: SourceId): AsyncState<CandlesResponse> {
  const imp = useImportedSeries(source === 'imported');
  const remote = useAsync<CandlesResponse>(
    (signal) => getJson(`/api/market/spikes?candles=${encodeURIComponent(key!)}&window=${window}&source=${source === 'rateboard' ? 'rateboard' : 'sample'}`, signal),
    [key, window, source],
    !!key && source !== 'imported',
  );
  const local = useMemo(() => {
    const s = imp?.series.find((x) => x.key === key);
    return s && imp ? ({ source: 'imported', key: s.key, window, candles: buildCandles(s, imp.snap.t, window) } as CandlesResponse) : null;
  }, [imp, key, window]);
  return source === 'imported' ? done(local, key && !local ? 'No imported bids for that player.' : null) : remote;
}

export function useForecastInputs(key: string | null, source: SourceId): AsyncState<ForecastInputs> {
  const imp = useImportedSeries(source === 'imported');
  const remote = useAsync<ForecastInputs>(
    (signal) => getJson(`/api/market/spikes?forecastInputs=${encodeURIComponent(key!)}&source=${source === 'rateboard' ? 'rateboard' : 'sample'}`, signal),
    [key, source],
    !!key && source !== 'imported',
  );
  const local = useMemo(() => (imp && key ? buildForecastInputs(imp.series, key, imp.snap.t, [], 'imported') : null), [imp, key]);
  return source === 'imported' ? done(local, key && !local ? 'Not enough imported history for a forecast on this player.' : null) : remote;
}
