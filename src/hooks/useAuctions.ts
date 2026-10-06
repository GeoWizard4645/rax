import { getJson } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import type { AuctionsResponse } from '../types/market';

/** Auction bids + 7-day per-rating baselines + repeat contenders, from the edge aggregator. Refreshes every 60 s. */
export function useAuctions() {
  const state = useAsync<AuctionsResponse>((signal) => getJson('/api/scout/auctions?limit=600', signal), []);
  return state;
}
