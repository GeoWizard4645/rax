/**
 * Core formulas from the spec (§5) plus the statistics used by Tabs 2–3.
 * Pure functions only — shared by the edge functions and the browser.
 */
import type { Rarity, Sport } from '../src/types/real';
import type {
  CatalystTag,
  FairValuePoint,
  PlayerSeries,
  SeriesPoint,
  SpikeRow,
} from '../src/types/market';

export const SPORTS: Sport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'CBB', 'CFB', 'PGA', 'UFC'];
export const RARITIES: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mystic', 'Iconic'];

/** Rarity Tier Adjuster (spec §Tab 5). */
export const RARITY_MULT: Record<Rarity, number> = {
  Common: 1.0,
  Uncommon: 1.2,
  Rare: 1.6,
  Epic: 2.0,
  Legendary: 2.5,
  Mystic: 3.2,
  Iconic: 4.0,
};

/**
 * Sport multipliers for OTD yield. The spec names a "Sport Multiplier" but gives no
 * values, so every sport defaults to 1.0 — override them in Tab 4's settings once
 * the real values are known. Nothing here is guessed.
 */
export const DEFAULT_SPORT_MULT: Record<Sport, number> = {
  NFL: 1, NBA: 1, MLB: 1, NHL: 1, CBB: 1, CFB: 1, PGA: 1, UFC: 1,
};

/* ---------------------------- Tab 2 ---------------------------- */

/** Per-Rating Price = Highest Bid / Card Rating. */
export const perRatingPrice = (highestBid: number, rating: number): number =>
  rating > 0 ? highestBid / rating : 0;

/** Discount slider range: +30% above the bid down to 70% off. Negative = above the bid. */
export const DISCOUNT_MIN = -30;
export const DISCOUNT_MAX = 70;
export const clampDiscount = (d: number) => Math.min(DISCOUNT_MAX, Math.max(DISCOUNT_MIN, d));

/** Target Price = Highest Bid * (1 - Discount%/100). */
export const targetPrice = (highestBid: number, discountPct: number): number =>
  highestBid * (1 - clampDiscount(discountPct) / 100);

/** How far a per-rating price sits above its 7-day median, in percent. */
export const premiumPct = (prp: number, baselineMedian: number): number =>
  baselineMedian > 0 ? (prp / baselineMedian - 1) * 100 : 0;

export interface PitchInput {
  highestBid: number;
  playerName: string;
  targetPrice: number;
  cardRating: number;
}

/** Click-to-copy pitch (spec §Tab 2). Prices are rounded to whole Rax; the ratio keeps 2 decimals. */
export function buildPitch(i: PitchInput): string {
  const rating = perRatingPrice(i.targetPrice, i.cardRating);
  return (
    `Saw your ${Math.round(i.highestBid).toLocaleString('en-US')} Rax bid on ${i.playerName}. ` +
    `I will sell you mine right now for ${Math.round(i.targetPrice).toLocaleString('en-US')} Rax. ` +
    `That's a ${rating.toFixed(2)}/1 price per rating. Drop an offer on my profile.`
  );
}

export const realLink = (username: string) => `https://realapp.link/u/${encodeURIComponent(username)}`;
export const realDeepLink = (userId: string) => `realapp://user/${encodeURIComponent(userId)}/chat`;

/* ---------------------------- statistics ---------------------------- */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Sample standard deviation (n - 1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** z-score with a floor on the deviation so a flat baseline can't produce infinities. */
export function zScore(value: number, baseline: number[]): number {
  const m = mean(baseline);
  const sd = Math.max(stdev(baseline), Math.abs(m) * 0.05, 1e-9);
  return (value - m) / sd;
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  /** Standard deviation of residuals. */
  residualSd: number;
  n: number;
}

/** Ordinary least squares y = intercept + slope * x. */
export function linearRegression(points: Array<{ x: number; y: number }>): Regression {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n ? points[0].y : 0, r2: 0, residualSd: 0, n };
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = sum(points.map((p) => (p.y - (intercept + slope * p.x)) ** 2));
  const r2 = syy === 0 ? 0 : 1 - ssRes / syy;
  const residualSd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { slope, intercept, r2, residualSd, n };
}

/* ---------------------------- Tab 3 ---------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SPIKE_Z = 2;

/** Weighted mean of avgBid by volume. */
function weightedAvgBid(pts: SeriesPoint[]): number {
  const v = sum(pts.map((p) => p.volume));
  return v > 0 ? sum(pts.map((p) => p.avgBid * p.volume)) / v : 0;
}

/**
 * Velocity spike screen. Compares the last 24h to the seven 24h windows before it:
 * a card is flagged when its 24h transaction volume OR average bid price is more than
 * `threshold` standard deviations above that trailing 7-day baseline.
 */
export function detectSpike(
  series: PlayerSeries,
  now: number,
  catalysts: CatalystTag[] = [],
  threshold = SPIKE_Z,
): SpikeRow | null {
  const pts = series.points;
  const last = pts.filter((p) => p.t > now - DAY && p.t <= now);
  if (!last.length) return null;

  const dailyVol: number[] = [];
  const dailyBid: number[] = [];
  for (let d = 1; d <= 7; d++) {
    const w = pts.filter((p) => p.t > now - (d + 1) * DAY && p.t <= now - d * DAY);
    if (!w.length) continue;
    dailyVol.push(sum(w.map((p) => p.volume)));
    const b = weightedAvgBid(w);
    if (b > 0) dailyBid.push(b);
  }
  if (dailyVol.length < 3) return null;

  const volume24h = sum(last.map((p) => p.volume));
  const avgBid24h = weightedAvgBid(last);
  const volumeZ = zScore(volume24h, dailyVol);
  const avgBidZ = dailyBid.length >= 3 ? zScore(avgBid24h, dailyBid) : 0;
  const z = Math.max(volumeZ, avgBidZ);
  if (z <= threshold) return null;

  return {
    key: series.key,
    playerName: series.playerName,
    sport: series.sport,
    rating: series.rating,
    rarity: series.rarity,
    volume24h,
    volumeBaseline: mean(dailyVol),
    volumeZ,
    avgBid24h,
    avgBidBaseline: mean(dailyBid),
    avgBidZ,
    z,
    catalysts,
  };
}

/** Median sale price over the trailing window for one player (uses medPrp × rating). */
export function medianPrice(series: PlayerSeries, now: number, windowMs = 7 * DAY): number {
  const w = series.points.filter((p) => p.t > now - windowMs && p.t <= now && p.volume > 0);
  return median(w.map((p) => p.medPrp * series.rating));
}

export interface FairValueResult {
  points: FairValuePoint[];
  regression: Regression;
}

/**
 * Fair Value Index: regress median sale price on card rating, then flag cards sitting
 * well below the line. "Undervalued" = at least 1 residual-SD below the line AND at
 * least 15% under the fair price (so a tight cloud can't flag trivial gaps).
 */
export function fairValue(
  items: Array<{ key: string; playerName: string; sport: Sport; rating: number; medianPrice: number }>,
): FairValueResult {
  const regression = linearRegression(items.map((i) => ({ x: i.rating, y: i.medianPrice })));
  const points = items.map((i): FairValuePoint => {
    const fairPrice = Math.max(0, regression.intercept + regression.slope * i.rating);
    const deviation = fairPrice > 0 ? (i.medianPrice - fairPrice) / fairPrice : 0;
    const residualZ = regression.residualSd > 0 ? (i.medianPrice - fairPrice) / regression.residualSd : 0;
    return {
      ...i,
      fairPrice,
      deviation,
      residualZ,
      undervalued: residualZ <= -1 && deviation <= -0.15,
    };
  });
  return { points, regression };
}

export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleWindow = '24h' | '7d' | '30d';
export const WINDOW_CONFIG: Record<CandleWindow, { spanMs: number; bucketMs: number }> = {
  '24h': { spanMs: DAY, bucketMs: HOUR },
  '7d': { spanMs: 7 * DAY, bucketMs: 6 * HOUR },
  '30d': { spanMs: 30 * DAY, bucketMs: DAY },
};

/** Merge series points (hourly or coarser) into OHLC + volume candles for a window. */
export function buildCandles(series: PlayerSeries, now: number, win: CandleWindow): Candle[] {
  const { spanMs, bucketMs } = WINDOW_CONFIG[win];
  const from = now - spanMs;
  const buckets = new Map<number, SeriesPoint[]>();
  for (const p of series.points) {
    if (p.t <= from || p.t > now) continue;
    const b = Math.floor((p.t - from - 1) / bucketMs);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(p);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, ps]) => {
      const sorted = [...ps].sort((x, y) => x.t - y.t);
      return {
        t: from + (b + 1) * bucketMs,
        open: sorted[0].open,
        high: Math.max(...sorted.map((p) => p.high)),
        low: Math.min(...sorted.map((p) => p.low)),
        close: sorted[sorted.length - 1].close,
        volume: sum(sorted.map((p) => p.volume)),
      };
    });
}

/* ---------------------------- misc ---------------------------- */

/** Stable lookup key for a player within a sport. */
export const playerKey = (sport: string, name: string) =>
  `${sport}:${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

export const fmtRax = (n: number) => Math.round(n).toLocaleString('en-US');
