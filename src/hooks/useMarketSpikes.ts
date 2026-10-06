import { getJson } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import type { CandlesResponse, ForecastInputs, SpikesResponse } from '../types/market';
import type { Sport } from '../types/real';

export const useMarketSpikes = (sport: Sport | 'ALL') =>
  useAsync<SpikesResponse>((signal) => getJson(`/api/market/spikes${sport === 'ALL' ? '' : `?sport=${sport}`}`, signal), [sport]);

export const useCandles = (key: string | null, window: '24h' | '7d' | '30d') =>
  useAsync<CandlesResponse>((signal) => getJson(`/api/market/spikes?candles=${encodeURIComponent(key!)}&window=${window}`, signal), [key, window], !!key);

export const useForecastInputs = (key: string | null) =>
  useAsync<ForecastInputs>((signal) => getJson(`/api/market/spikes?forecastInputs=${encodeURIComponent(key!)}`, signal), [key], !!key);
