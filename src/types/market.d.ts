// Market, auction and analytics types.

import type { Rarity, Sport } from './real';

/**
 * Where a dataset came from — drives the LIVE / SAMPLE badge shown in the UI.
 *  - 'live'      a real Real-side feed (only when an authorised upstream is configured)
 *  - 'rateboard' Rateboard's public offer board: standing BUY offers expressed as a rate per rating point (not sale prices)
 *  - 'imported'  a snapshot the user copied from their own Real session
 *  - 'real'      auctions, sales and market stats the user recorded from their own signed-in Real web session (shared/realMarket.ts)
 *  - 'sample'    synthetic demo data
 */
export type DataSource = 'live' | 'sample' | 'imported' | 'rateboard' | 'real';

/** Sports that can appear in market data: Real's sports plus FC (soccer), which Rateboard lists but the card feeds don't; 'ALL' marks a pooled series whose sport is not known (captured Real sales don't carry one). */
export type MarketSport = Sport | 'FC' | 'ALL';

/** What the numbers in a series/response mean: Rax prices (auction bids), Rateboard bid rates (Rax per rating point), or real SALE prices captured from the user's own Real session. */
export type MarketUnit = 'rax' | 'rate' | 'sales';

/** How much history the Rateboard-derived recorder has — shown wherever those numbers are. */
export interface RateCoverage {
  firstAt: number | null;
  lastAt: number | null;
  /** Calendar span between the first and last recorded sample, in days. */
  spanDays: number;
  /** UTC hours with at least one sample. */
  hoursSampled: number;
  samples: number;
  /** Samples that came from Rateboard's own rolling backups rather than from live polling. */
  seeded: number;
  players: number;
  /** True once there is enough history for spikes / candles / forecasts (see MIN_HISTORY_DAYS). */
  ready: boolean;
  /** False when no KV namespace is bound — history then lives only in the running isolate and will be lost. */
  persisted: boolean;
}

export interface AuctionBid {
  auctionId: string;
  cardId: string;
  playerName: string;
  sport: Sport;
  rarity: Rarity;
  cardRating: number;
  highestBidRax: number;
  /** highestBidRax / cardRating */
  perRatingPrice: number;
  bidderUsername: string;
  bidderUserId: string;
  timestamp: string;
  expiresAt: string;
  status: 'active' | 'closed';
}

/** A bidder who is repeatedly bidding on / buying one specific card (Tab 2, "Repeat Contenders"). */
export interface ContenderActivity {
  bidderUsername: string;
  bidderUserId: string;
  playerName: string;
  sport: Sport;
  /** Rarity tier they currently hold of this player. */
  rarity: Rarity;
  /** Rating of the card they are chasing (used to turn a per-rating price into Rax). */
  cardRating: number;
  /** Copies they hold; 0 when the feed doesn't expose it. */
  copiesOwned: number;
  bids7d: number;
  buys7d: number;
  /** Mean per-rating price across their bids + buys in the last 7 days. */
  avgPerRating7d: number;
  lastActivityAt: string;
}

/** One hourly bucket of market activity for a player. */
export interface SeriesPoint {
  /** Unix ms, start of the hour. */
  t: number;
  /** Transactions + bids in the hour. */
  volume: number;
  /** Mean bid price in Rax. */
  avgBid: number;
  /** Median per-rating price in the hour. */
  medPrp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PlayerSeries {
  key: string;
  playerName: string;
  sport: MarketSport;
  /** Card rating. Rateboard-derived series have no rating: it is 1, so "per rating" values equal the bid rate. */
  rating: number;
  /** null when the source doesn't say (Rateboard offers don't). */
  rarity: Rarity | null;
  points: SeriesPoint[];
}

export type CatalystTag = 'Game Tonight' | 'OTD Anniversary' | 'Injury Replacement' | 'Streak Multiplier';

export interface SpikeRow {
  key: string;
  playerName: string;
  sport: MarketSport;
  rating: number;
  rarity: Rarity | null;
  volume24h: number;
  volumeBaseline: number;
  volumeZ: number;
  avgBid24h: number;
  avgBidBaseline: number;
  avgBidZ: number;
  /** The larger of volumeZ and avgBidZ. */
  z: number;
  catalysts: CatalystTag[];
}

export interface FairValuePoint {
  key: string;
  playerName: string;
  sport: MarketSport;
  /** x-axis value: card rating for price data; buyer count for Rateboard bid-rate data (see SpikesResponse.xAxis). */
  rating: number;
  medianPrice: number;
  /** Price the regression line predicts at this rating. */
  fairPrice: number;
  /** (medianPrice - fairPrice) / fairPrice */
  deviation: number;
  /** Residual in standard deviations. */
  residualZ: number;
  undervalued: boolean;
}

export interface AuctionsResponse {
  source: DataSource;
  generatedAt: string;
  bids: AuctionBid[];
  /** 7-day median per-rating price by player key. */
  baselines: Record<string, number>;
  contenders: ContenderActivity[];
  note?: string;
}

export interface PlayerRef {
  key: string;
  playerName: string;
  sport: MarketSport;
  rating: number;
  rarity: Rarity | null;
}

export interface FairValueModel {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

/** Summary view computed at the edge so the browser never downloads raw history. */
export interface SpikesResponse {
  source: DataSource;
  generatedAt: string;
  spikes: SpikeRow[];
  fair: FairValuePoint[];
  model: FairValueModel;
  players: PlayerRef[];
  note?: string;
  /** 'rate' = Rateboard bid rates (Rax per rating point); default 'rax' = prices. */
  unit?: MarketUnit;
  /** What FairValuePoint.rating means: 'rating' (default) or 'buyers'. */
  xAxis?: 'rating' | 'buyers';
  /** Present for Rateboard-derived data. */
  coverage?: RateCoverage;
  /** Present for the Real marketplace source: what the price-spike screener could test. */
  real?: { asOf: number; eligible: number; tested: number; reason: string };
}

export interface CandlesResponse {
  source: DataSource;
  unit?: MarketUnit;
  coverage?: RateCoverage;
  /** Rateboard data only: the raw recorded change log for this player, oldest first: [t, best, median, buyers, offers, house]. */
  changes?: Array<[number, number, number, number, number, number]>;
  /** Rateboard data only: the player's current state, or null when nobody is bidding on them now. */
  current?: { best: number; median: number; buyers: number; offers: number; house: number; floor?: number | null } | null;
  key: string;
  window: '24h' | '7d' | '30d';
  /** Real marketplace source: the windows end at the newest captured sale (ms), not at "now". */
  asOf?: number;
  candles: Array<{ t: number; open: number; high: number; low: number; close: number; volume: number }>;
}

/** Everything the browser-side Monte Carlo needs about one player, assembled at the edge. */
export interface ForecastInputs {
  source: DataSource;
  key: string;
  playerName: string;
  sport: MarketSport;
  rarity: Rarity | null;
  rating: number;
  unit?: MarketUnit;
  coverage?: RateCoverage;
  /** Latest per-rating price (Rax per rating point). */
  currentPpr: number;
  /** Daily per-rating closes and volumes, oldest first (up to 30 days). */
  daily: Array<{ t: number; ppr: number; volume: number }>;
  /** Similar cards (same sport + rarity where possible), excluding this player. */
  peers: {
    n: number;
    scope: 'sport+rarity' | 'rarity' | 'all' | 'none';
    /** Pooled daily log-return standard deviation of per-rating price. */
    sdLogRet: number;
    medianPpr: number;
    medianVolPerDay: number;
  };
  catalysts: CatalystTag[];
  /** Current velocity-spike z-score (0 when not spiking). */
  spikeZ: number;
}
