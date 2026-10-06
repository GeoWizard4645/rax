// Market, auction and analytics types.

import type { Rarity, Sport } from './real';

/** Where a dataset came from — drives the LIVE / SAMPLE badge shown in the UI. */
export type DataSource = 'live' | 'sample' | 'imported';

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
  sport: Sport;
  rating: number;
  rarity: Rarity;
  points: SeriesPoint[];
}

export type CatalystTag = 'Game Tonight' | 'OTD Anniversary' | 'Injury Replacement' | 'Streak Multiplier';

export interface SpikeRow {
  key: string;
  playerName: string;
  sport: Sport;
  rating: number;
  rarity: Rarity;
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
  sport: Sport;
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
  sport: Sport;
  rating: number;
  rarity: Rarity;
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
}

export interface CandlesResponse {
  source: DataSource;
  key: string;
  window: '24h' | '7d' | '30d';
  candles: Array<{ t: number; open: number; high: number; low: number; close: number; volume: number }>;
}

/** Everything the browser-side Monte Carlo needs about one player, assembled at the edge. */
export interface ForecastInputs {
  source: DataSource;
  key: string;
  playerName: string;
  sport: Sport;
  rarity: Rarity;
  rating: number;
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
