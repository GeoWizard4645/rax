/**
 * Rateboard bid-rate history  —  the one real market time series this app can build for free.
 *
 * WHAT IT MEASURES: Rateboard's public board lists standing BUY offers: "I'll pay <rate> Rax per rating point
 * for <player>". Nothing here is a Real sale price, an auction bid or a fair market value. A card with rating R
 * would fetch about R × rate Rax from that buyer (that is Rateboard's own formula, see owedFor). Cards' rating,
 * rarity and the auction clock are NOT in the data and are never invented (rating = 1, rarity = null).
 *
 * HOW IT IS RECORDED: the edge samples the board (/api/market/rates, pinged ~every 10 min by a GitHub Actions cron
 * and by anyone using Tabs 2–3) and keeps ONE small JSON document in Workers KV. Bid rates change rarely, so each
 * player stores only the points where something changed (a "change log"), not one point per sample — that keeps the
 * document to a few hundred KB and KV writes to ≤144/day. Hourly series are rebuilt by forward-filling the change
 * log across the UTC hours that were actually sampled (gaps stay gaps).
 *
 * Pure functions only: shared by the edge, the seed script and the tests.
 */
import type { PlayerSeries, PlayerRef, RateCoverage, SeriesPoint, SpikeRow, SpikesResponse } from '../src/types/market';
import { fairValue, median, mean, playerKey, zScore } from './formulas';
import { houseFor, norm, type RbBoard, type RbSport } from './rateboard';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const RB_HIST_KEY = 'rbrates:v1';
/** History kept in the document. Candles/forecasts look at 30 days at most. */
export const RETAIN_MS = 35 * DAY;
/** Spikes, candles' trend and forecasts are only shown once the recorder spans this many days… */
export const MIN_HISTORY_DAYS = 3;
/** …and has actually sampled at least this many distinct hours (a span with holes isn't history). */
export const MIN_HISTORY_HOURS = 48;
/** The Monte Carlo needs a run of daily points; below this it explains instead of simulating. */
export const MIN_FORECAST_DAYS = 5;

/** [t, best, median, buyers, offers, house] — `t` is when the change was first seen. best/med are Rax per rating point; 0 = no offers. */
export type RbPt = [t: number, best: number, med: number, buyers: number, offers: number, house: number];

export interface RbPlayerHist {
  /** Sport (Rateboard code: CFB, FC, NFL, UFC, NHL). */
  s: RbSport;
  /** Display name. */
  n: string;
  pts: RbPt[];
}

export interface RbHistDoc {
  v: 1;
  updatedAt: number;
  firstAt: number;
  lastAt: number;
  samples: number;
  /** How many of `samples` came from Rateboard's rolling backups (see scripts/seed-rb-history.ts). */
  seeded: number;
  /** UTC hour indexes (floor(t / HOUR)) that have at least one sample, ascending. */
  hours: number[];
  /** Board-wide totals per sampled hour: [hourStart, live offers, buyers, players]. */
  board: Array<[number, number, number, number]>;
  players: Record<string, RbPlayerHist>;
}

export const emptyDoc = (): RbHistDoc => ({ v: 1, updatedAt: 0, firstAt: 0, lastAt: 0, samples: 0, seeded: 0, hours: [], board: [], players: {} });

/* ------------------------------ sampling ------------------------------ */

export interface RbAgg {
  key: string;
  sport: RbSport;
  name: string;
  best: number;
  med: number;
  buyers: number;
  offers: number;
  house: number;
}

/** Stable series key for a Rateboard player (suffix-insensitive, accent-insensitive — same matching Rateboard uses). */
export const rbKey = (sport: string, player: string) => playerKey(sport, norm(player));

/** Roll the board's live (non-banned) offers up per player. */
export function aggregateBoard(board: RbBoard): RbAgg[] {
  const groups = new Map<string, { sport: RbSport; name: string; ts: number; rates: number[]; users: Set<string> }>();
  for (const o of board.offers) {
    if (board.users[o.user]?.banned) continue;
    if (!(o.rate > 0) || !o.player) continue;
    const key = rbKey(o.sport, o.player);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sport: o.sport, name: o.player, ts: o.ts, rates: [], users: new Set() }));
    if (o.ts > g.ts) (g.name = o.player), (g.ts = o.ts);
    g.rates.push(o.rate);
    g.users.add(o.user);
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    sport: g.sport,
    name: g.name,
    best: Math.max(...g.rates),
    med: median(g.rates),
    buyers: g.users.size,
    offers: g.rates.length,
    house: houseFor(board, g.sport, g.name)?.rate ?? 0,
  }));
}

/**
 * Guard against recording a glitch: an empty or hollowed-out board (upstream hiccup, partial read) would otherwise
 * write "everyone's bids vanished" into the history. A sample is rejected when the board is empty, or when the live
 * offer count falls by more than half against the previous sample (a real crash of that size is almost certainly a
 * bad read; if it is real, the next samples will confirm it only if it persists — we do not accept it silently).
 */
export function plausibleSample(prior: RbHistDoc | null, aggs: RbAgg[]): boolean {
  const offers = aggs.reduce((n, a) => n + a.offers, 0);
  if (offers === 0) return false;
  const last = prior?.board[prior.board.length - 1];
  if (last && last[1] >= 40 && offers < last[1] * 0.5) return false;
  return true;
}

/** Distinct live (non-banned) buyers on the board. */
export const distinctBuyers = (board: RbBoard): number => new Set(board.offers.filter((o) => !board.users[o.user]?.banned && o.rate > 0).map((o) => o.user)).size;

const sameState = (a: RbPt, b: RbPt) => a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
const ZERO = (t: number): RbPt => [t, 0, 0, 0, 0, 0];

/** Drop change points older than RETAIN_MS (keeping the last one before the cutoff as the anchor state). */
function prune(doc: RbHistDoc, now: number) {
  const cut = now - RETAIN_MS;
  for (const [k, p] of Object.entries(doc.players)) {
    let i = 0;
    while (i + 1 < p.pts.length && p.pts[i + 1][0] < cut) i++;
    if (i > 0) p.pts = p.pts.slice(i);
    if (p.pts.length === 1 && p.pts[0][1] === 0 && p.pts[0][0] < cut) delete doc.players[k];
  }
  const cutHour = Math.floor(cut / HOUR);
  doc.hours = doc.hours.filter((h) => h >= cutHour);
  doc.board = doc.board.filter((b) => b[0] >= cutHour * HOUR);
}

/**
 * Record one sample taken at `now`. Idempotent in the sense that matters: sampling an unchanged board adds no change
 * points. Samples older than the newest recorded one are ignored (clock skew / replays).
 */
export function appendSample(prior: RbHistDoc | null, aggs: RbAgg[], now: number, buyers?: number): RbHistDoc {
  const doc = prior ?? emptyDoc();
  if (doc.lastAt && now < doc.lastAt) return doc;
  const seen = new Set<string>();
  for (const a of aggs) {
    seen.add(a.key);
    const pt: RbPt = [now, a.best, a.med, a.buyers, a.offers, a.house];
    const p = (doc.players[a.key] ??= { s: a.sport, n: a.name, pts: [] });
    p.n = a.name;
    const last = p.pts[p.pts.length - 1];
    if (!last || !sameState(last, pt)) p.pts.push(pt);
  }
  for (const [k, p] of Object.entries(doc.players)) {
    if (seen.has(k)) continue;
    const last = p.pts[p.pts.length - 1];
    if (last && last[1] > 0) p.pts.push(ZERO(now)); // offers disappeared: record the gap
  }
  const hour = Math.floor(now / HOUR);
  if (doc.hours[doc.hours.length - 1] !== hour) doc.hours.push(hour);
  const tot: [number, number, number, number] = [hour * HOUR, aggs.reduce((n, a) => n + a.offers, 0), buyers ?? aggs.reduce((n, a) => Math.max(n, a.buyers), 0), aggs.length];
  const lastTot = doc.board[doc.board.length - 1];
  if (lastTot && lastTot[0] === tot[0]) doc.board[doc.board.length - 1] = tot;
  else doc.board.push(tot);
  if (!doc.firstAt) doc.firstAt = now;
  doc.lastAt = now;
  doc.samples++;
  prune(doc, now);
  return doc;
}

/**
 * Merge an older document (the seed built from Rateboard's rolling backups) underneath the live one. Only change
 * points earlier than the live document's first sample are taken, so it is safe to call repeatedly.
 */
export function mergeSeed(live: RbHistDoc | null, seed: RbHistDoc): RbHistDoc {
  if (!live || !live.samples) {
    const d = structuredCloneDoc(seed);
    d.seeded = d.samples;
    d.updatedAt = 0; // never persisted from here yet
    return d;
  }
  if (live.seeded > 0 || !seed.samples) return live;
  const cut = live.firstAt;
  const out = live;
  for (const [k, sp] of Object.entries(seed.players)) {
    const older = sp.pts.filter((p) => p[0] < cut);
    if (!older.length) continue;
    const lp = out.players[k];
    if (lp) {
      lp.pts = [...older, ...lp.pts];
    } else {
      out.players[k] = { s: sp.s, n: sp.n, pts: [...older] };
    }
  }
  // Players that were only in the live doc need no anchor from the seed: their state before `cut` is simply unknown.
  out.hours = [...new Set([...seed.hours.filter((h) => h * HOUR < cut), ...out.hours])].sort((a, b) => a - b);
  out.board = [...seed.board.filter((b) => b[0] < cut), ...out.board].sort((a, b) => a[0] - b[0]);
  out.seeded = seed.samples;
  out.samples += out.seeded;
  out.firstAt = Math.min(out.firstAt, seed.firstAt || out.firstAt);
  return out;
}

const structuredCloneDoc = (d: RbHistDoc): RbHistDoc => JSON.parse(JSON.stringify(d));

/* ------------------------------ read side ------------------------------ */

export function coverage(doc: RbHistDoc | null, persisted: boolean): RateCoverage {
  if (!doc || !doc.samples) {
    return { firstAt: null, lastAt: null, spanDays: 0, hoursSampled: 0, samples: 0, seeded: 0, players: 0, ready: false, persisted };
  }
  const spanDays = Math.max(0, (doc.lastAt - doc.firstAt) / DAY);
  const hoursSampled = doc.hours.length;
  return {
    firstAt: doc.firstAt,
    lastAt: doc.lastAt,
    spanDays,
    hoursSampled,
    samples: doc.samples,
    seeded: doc.seeded,
    players: Object.values(doc.players).filter((p) => p.pts[p.pts.length - 1]?.[1] > 0).length,
    ready: spanDays >= MIN_HISTORY_DAYS && hoursSampled >= MIN_HISTORY_HOURS,
    persisted,
  };
}

/** Rebuild hourly SeriesPoints (value = best bid rate, volume = buyers standing) for one player. */
export function playerPoints(p: RbPlayerHist, hours: number[], now: number, spanMs = 30 * DAY): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const from = Math.floor((now - spanMs) / HOUR);
  let i = 0; // index of the first change point not yet applied
  let state: RbPt | null = null;
  for (const h of hours) {
    const start = h * HOUR;
    const end = start + HOUR;
    while (i < p.pts.length && p.pts[i][0] <= start) state = p.pts[i++];
    const startState = state;
    const inHour: RbPt[] = [];
    let j = i;
    while (j < p.pts.length && p.pts[j][0] < end) inHour.push(p.pts[j++]);
    if (inHour.length) {
      state = inHour[inHour.length - 1];
      i = j;
    }
    if (h < from) continue;
    const live = [startState, ...inHour].filter((x): x is RbPt => !!x && x[1] > 0);
    if (!live.length) continue;
    const bests = live.map((x) => x[1]);
    const close = live[live.length - 1]; // last state that still had bids (an hour that ends with everyone gone closes at its last bid)
    out.push({
      t: start,
      volume: close[3],
      avgBid: close[2],
      medPrp: close[2],
      open: startState && startState[1] > 0 ? startState[1] : bests[0],
      high: Math.max(...bests),
      low: Math.min(...bests),
      close: close[1],
    });
  }
  return out;
}

const TO_SPORT = (s: RbSport) => s;

/** Hourly series for every player that has had a bid in the window. */
export function docToSeries(doc: RbHistDoc, now: number, spanMs = 30 * DAY): PlayerSeries[] {
  const out: PlayerSeries[] = [];
  for (const [key, p] of Object.entries(doc.players)) {
    const points = playerPoints(p, doc.hours, now, spanMs);
    if (!points.length) continue;
    out.push({ key, playerName: p.n, sport: TO_SPORT(p.s), rating: 1, rarity: null, points });
  }
  return out;
}

/** Latest known state of a player, or null when nobody is bidding on them now. */
export const currentState = (p: RbPlayerHist): RbPt | null => {
  const last = p.pts[p.pts.length - 1];
  return last && last[1] > 0 ? last : null;
};

/**
 * 7-day median bid rate per player (median of the hourly median-offer rate), only for players with at least
 * `minHours` sampled hours of bids in the window. Empty until the recorder is `ready` — a baseline from a few
 * hours would be noise dressed up as history.
 */
export function rateBaselines(doc: RbHistDoc | null, now: number, minHours = 24): Record<string, number> {
  if (!doc || !coverage(doc, true).ready) return {};
  const out: Record<string, number> = {};
  for (const s of docToSeries(doc, now, 7 * DAY)) {
    if (s.points.length < minHours) continue;
    out[s.key] = median(s.points.map((p) => p.medPrp));
  }
  return out;
}

/* ------------------------------ spikes ------------------------------ */

/**
 * Demand spike screen on recorded bid rates. Compares the last 24h with the seven 24h windows before it: flagged when
 * the average best bid rate OR the number of buyers standing is >2 standard deviations above that baseline AND the move
 * is material (rate +20% and ≥2 Rax/rating; or +2 buyers and +50%). Reported through SpikeRow with
 * volume* = buyers standing, avgBid* = best bid rate (so the existing card can show it with its labels switched).
 */
export function detectRateSpike(series: PlayerSeries, now: number, threshold = 2): SpikeRow | null {
  const win = (d: number) => series.points.filter((p) => p.t > now - (d + 1) * DAY && p.t <= now - d * DAY);
  const last = win(0);
  if (last.length < 6) return null;
  const rates: number[] = [];
  const buyers: number[] = [];
  for (let d = 1; d <= 7; d++) {
    const w = win(d);
    if (w.length < 6) continue;
    rates.push(mean(w.map((p) => p.close)));
    buyers.push(mean(w.map((p) => p.volume)));
  }
  if (rates.length < 3) return null;
  const rate24 = mean(last.map((p) => p.close));
  const buyers24 = mean(last.map((p) => p.volume));
  const rateZ = zScore(rate24, rates);
  const buyersZ = zScore(buyers24, buyers);
  const rateBase = mean(rates);
  const buyersBase = mean(buyers);
  const rateUp = rateZ > threshold && rate24 >= rateBase * 1.2 && rate24 - rateBase >= 2;
  const buyersUp = buyersZ > threshold && buyers24 - buyersBase >= 2 && buyers24 >= buyersBase * 1.5;
  if (!rateUp && !buyersUp) return null;
  return {
    key: series.key,
    playerName: series.playerName,
    sport: series.sport,
    rating: 1,
    rarity: null,
    volume24h: buyers24,
    volumeBaseline: buyersBase,
    volumeZ: buyersZ,
    avgBid24h: rate24,
    avgBidBaseline: rateBase,
    avgBidZ: rateZ,
    z: Math.max(rateUp ? rateZ : 0, buyersUp ? buyersZ : 0),
    catalysts: [],
  };
}

/**
 * Tab 3 summary for Rateboard bid rates.
 *  - "fair" panel = median bid rate vs buyers standing, with a least-squares trendline. It works from the very first
 *    sample (no history needed) and is a depth-vs-rate picture, NOT a fair-value estimate: Rateboard has no ratings or prices.
 *  - spikes only once the recorder is ready.
 */
export function summarizeRates(doc: RbHistDoc | null, now: number, persisted: boolean): SpikesResponse {
  const cov = coverage(doc, persisted);
  const cur: Array<{ key: string; playerName: string; sport: RbSport; rating: number; medianPrice: number }> = [];
  const players: PlayerRef[] = [];
  if (doc) {
    for (const [key, p] of Object.entries(doc.players)) {
      const s = currentState(p);
      if (!s) continue;
      cur.push({ key, playerName: p.n, sport: p.s, rating: s[3], medianPrice: s[2] });
      players.push({ key, playerName: p.n, sport: p.s, rating: 1, rarity: null });
    }
  }
  const spikes: SpikeRow[] = [];
  if (doc && cov.ready) {
    for (const s of docToSeries(doc, now, 9 * DAY)) {
      const sp = detectRateSpike(s, now);
      if (sp) spikes.push(sp);
    }
    spikes.sort((a, b) => b.z - a.z);
  }
  const fv = fairValue(cur);
  return {
    source: 'rateboard',
    generatedAt: new Date(now).toISOString(),
    unit: 'rate',
    xAxis: 'buyers',
    coverage: cov,
    spikes,
    fair: fv.points,
    model: { slope: fv.regression.slope, intercept: fv.regression.intercept, r2: fv.regression.r2, n: fv.regression.n },
    players,
    note: cov.samples
      ? cov.ready
        ? 'Bid rates recorded from Rateboard’s public board (Rax per rating point). These are standing buy offers, not Real sale prices.'
        : `Recording since ${new Date(cov.firstAt!).toISOString().slice(0, 16).replace('T', ' ')} UTC — ${cov.spanDays.toFixed(1)} day(s), ${cov.hoursSampled} hours sampled. Spikes, candles and forecasts unlock after ${MIN_HISTORY_DAYS} days.`
      : 'No bid-rate history recorded yet.',
  };
}
