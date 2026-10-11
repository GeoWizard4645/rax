/**
 * Tab 9 — turns the per-source quotes on an OddsEvent into no-vig "fair" probabilities and a weighted consensus. Pure.
 *
 * Per source:
 *   - Sportsbook (DraftKings via ESPN): the two (or three) prices carry a vig, so it is removed (proportional de-vig by
 *     default, `power` optional — it shaves the favourite/longshot bias a little better). Weight 1.
 *   - Exchange (Kalshi, Polymarket): a YES price is already a probability, there is no vig. We still normalise the pair so
 *     it sums to 1 (Kalshi's two team contracts are separate order books, each quoted as a bid/ask mid). The weight is the
 *     product of a liquidity factor (log of traded volume) and a tightness factor (bid/ask width), 0.04 – 1.
 * The consensus is the weight-averaged fair probability of outcome 0; `spread` = max − min across sources, which the UI
 * should surface as a "sources disagree" warning.
 */
import type { MarketType, OddsEvent, OddsMarket, OddsSource } from './odds';
import { devig2, devig2Power, devigN } from './odds';

export type DevigMethod = 'proportional' | 'power';

export interface SourceFair {
  source: OddsSource;
  /** Fair probabilities of [outcome 0 (home / over), outcome 1 (away / under)]; for 3-way markets they exclude the draw share. */
  fair: [number, number];
  /** Fair probability of a draw (3-way soccer moneyline), else null. */
  draw: number | null;
  /** Sum of the raw implied probabilities (1.0 = no vig). Books ≈ 1.04–1.10; exchanges ≈ 1.00 ± bid/ask noise. */
  overround: number;
  /** True when a bookmaker margin was removed (sportsbooks); false for exchanges (only normalised). */
  vigRemoved: boolean;
  weight: number;
  volume: number | null;
  width: number | null;
  updatedAt: string;
  url: string | null;
}

export interface Consensus {
  type: MarketType;
  line: number | null;
  /** Display names of outcome 0 / 1 (team names, or Over / Under). */
  names: [string, string];
  sources: SourceFair[];
  /** Weighted consensus [outcome 0, outcome 1] (sums to 1 with `draw`); null if no source. */
  fair: [number, number] | null;
  draw: number | null;
  /** max − min of outcome-0 fair probability across sources (null with < 2 sources). 0.04 = 4 percentage points. */
  spread: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  warnings: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const SAME_LINE = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);

/** Exchange quality weight in [0.04, 1]: more traded volume and a tighter bid/ask book count for more. */
export function exchangeWeight(volume: number | null, width: number | null): number {
  const vol = volume === null ? 0.5 : clamp(Math.log10(1 + Math.max(0, volume)) / 4, 0.15, 1); // $10k ≈ 1.0, $100 ≈ 0.5
  const tight = width === null ? 0.6 : clamp(1 - width / 0.1, 0.2, 1); // 1c → 0.9, 5c → 0.5, ≥ 8c → 0.2
  return Math.round(vol * tight * 1000) / 1000;
}

/** Fair probabilities of one market (vig removed for books, normalised for exchanges). */
export function marketFair(m: OddsMarket, method: DevigMethod = 'proportional'): SourceFair {
  const isBook = m.source === 'espn-dk';
  const [a, b] = [m.outcomes[0].implied, m.outcomes[1].implied];
  const d = m.draw?.implied ?? null;
  let fair: [number, number];
  let draw: number | null = null;
  let overround: number;
  if (d !== null && Number.isFinite(d)) {
    const [fa, fb, fd] = devigN([a, b, d]);
    fair = [fa, fb];
    draw = fd;
    overround = a + b + d;
  } else {
    fair = isBook && method === 'power' ? devig2Power(a, b) : devig2(a, b);
    overround = a + b;
  }
  return {
    source: m.source,
    fair,
    draw,
    overround,
    vigRemoved: isBook,
    weight: isBook ? 1 : exchangeWeight(m.volume, m.width ?? null),
    volume: m.volume,
    width: m.width ?? null,
    updatedAt: m.updatedAt,
    url: m.url,
  };
}

export interface LineSummary {
  line: number | null;
  nSources: number;
  sources: OddsSource[];
  /** Consensus outcome-0 fair probability for this line. */
  fair0: number | null;
  /** |fair0 − 0.5|: smaller = closer to the "main" (pick'em) line. */
  distFromEven: number;
}

const marketsOf = (event: Pick<OddsEvent, 'markets'>, type: MarketType) => event.markets.filter((m) => m.type === type);

/**
 * Every line offered for a market type, best first: lines quoted by the most sources, then the one nearest 50/50.
 * `[0]` is the "main" line the consensus defaults to. Moneyline returns a single entry with line = null.
 */
export function bestLines(event: Pick<OddsEvent, 'markets'>, type: MarketType, method: DevigMethod = 'proportional'): LineSummary[] {
  const byLine = new Map<string, OddsMarket[]>();
  for (const m of marketsOf(event, type)) {
    const k = m.line === null ? 'null' : m.line.toFixed(3);
    byLine.set(k, [...(byLine.get(k) ?? []), m]);
  }
  const out: LineSummary[] = [];
  for (const ms of byLine.values()) {
    const sources = [...new Set(ms.map((m) => m.source))];
    const fair0 = weighted(ms.map((m) => marketFair(m, method)))?.[0] ?? null;
    out.push({ line: ms[0].line, nSources: sources.length, sources, fair0, distFromEven: fair0 === null ? 1 : Math.abs(fair0 - 0.5) });
  }
  return out.sort((a, b) => b.nSources - a.nSources || a.distFromEven - b.distFromEven);
}

/** The line to use by default for a type (most-quoted, then nearest a coin flip); null for moneyline or no market. */
export const mainLine = (event: Pick<OddsEvent, 'markets'>, type: MarketType): number | null => bestLines(event, type)[0]?.line ?? null;

function weighted(fs: SourceFair[]): [number, number, number | null] | null {
  if (!fs.length) return null;
  const w = fs.reduce((s, f) => s + f.weight, 0);
  if (!(w > 0)) return null;
  const f0 = fs.reduce((s, f) => s + f.weight * f.fair[0], 0) / w;
  const f1 = fs.reduce((s, f) => s + f.weight * f.fair[1], 0) / w;
  const withDraw = fs.filter((f) => f.draw !== null);
  const d = withDraw.length ? withDraw.reduce((s, f) => s + f.weight * (f.draw as number), 0) / withDraw.reduce((s, f) => s + f.weight, 0) : null;
  if (d !== null) {
    const t = f0 + f1 + d;
    return [f0 / t, f1 / t, d / t];
  }
  const t = f0 + f1;
  return [f0 / t, f1 / t, null];
}

/**
 * Per-source fair probabilities and the weighted consensus for one market of an event.
 * `line`: omit for the main line of a spread/total; pass null for moneyline. Soccer 3-way moneylines are normalised across
 * home / draw / away (the draw share is reported separately).
 */
export function consensusFair(event: Pick<OddsEvent, 'markets' | 'home' | 'away'>, type: MarketType, line?: number | null, method: DevigMethod = 'proportional'): Consensus {
  const want = type === 'moneyline' ? null : line === undefined ? mainLine(event, type) : line;
  const ms = marketsOf(event, type).filter((m) => SAME_LINE(m.line, want));
  const sources = ms.map((m) => marketFair(m, method)).filter((f) => Number.isFinite(f.fair[0]) && Number.isFinite(f.fair[1]));
  const names: [string, string] = type === 'total' ? [`Over ${want ?? ''}`.trim(), `Under ${want ?? ''}`.trim()] : [event.home, event.away];
  const warnings: string[] = [];
  const w = weighted(sources);
  const fair: [number, number] | null = w ? [w[0], w[1]] : null;
  const f0 = sources.map((s) => s.fair[0]);
  const spread = f0.length >= 2 ? Math.max(...f0) - Math.min(...f0) : null;

  if (!sources.length) warnings.push('No source quotes this market/line.');
  else if (sources.length === 1) warnings.push(`Single source (${sources[0].source}) — nothing to cross-check against.`);
  if (spread !== null && spread > 0.05) warnings.push(`Sources disagree by ${(spread * 100).toFixed(1)} percentage points — check for stale quotes or a different line.`);
  for (const s of sources) {
    if (s.vigRemoved === false && s.width !== null && s.width >= 0.05) warnings.push(`${s.source}: wide bid/ask (${(s.width * 100).toFixed(0)}c) — thin book.`);
    if (s.vigRemoved === false && (s.volume === null || s.volume < 100)) warnings.push(`${s.source}: little or no traded volume — price is a resting quote, not a market.`);
  }
  const tot = sources.reduce((a, s) => a + s.weight, 0);
  const confidence: Consensus['confidence'] = !sources.length
    ? 'none'
    : sources.length === 1 || tot < 0.5
      ? 'low'
      : spread !== null && spread <= 0.03
        ? 'high'
        : spread !== null && spread <= 0.06
          ? 'medium'
          : 'low';
  return { type, line: want, names, sources, fair, draw: w ? w[2] : null, spread, confidence, warnings };
}
