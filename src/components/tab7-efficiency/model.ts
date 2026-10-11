/** Glue between the snapshot, Real's rarity rules and the price model: one "level" (rung + price) per card. */
import type { EfficiencyParams } from '../../../shared/otdEfficiency';
import { ICONIC_LEVELS, RARITY_LADDER, capFor, multiplierFor } from '../../../shared/otdRules';
import { cloneParams, DEFAULT_PRICE_PARAMS, estimateCardPrice, rateBand, type PriceEstimate, type PriceParams } from '../../../shared/otdPricing';
import type { OtdCardRecord, OtdSport } from '../../../shared/otdSnapshot';
import { packRateFor, type PackIndex } from '../../../shared/raxedgePackOdds';

export type WindowPreset = '7' | '30' | '90' | '180' | '365' | '5y' | '10y' | 'custom';

export interface EffState {
  method: 'observed' | 'modeled';
  preset: WindowPreset;
  customDays: number;
  /** ISO date (YYYY-MM-DD) the window starts. '' = today. */
  start: string;
  /** 5/10-year views: is a card's cap a lifetime total (true) or does it reset every year (false, the working assumption)? */
  capLifetime: boolean;
  /** Pro's bonus claim: assumed poll win probability (0–1). 0 = ignore the bonus. */
  proWin: number;
  /** A rung key, or 'AUTO'. */
  rarity: string;
  /** In AUTO mode, never go below this rung. */
  autoMin: string;
  /** Optional multiplier override for the chosen (fixed) rung; 0 = use Real's. */
  multOverride: number;
  sports: OtdSport[];
  budget: number;
  maxCards: number;
  /** keep = you hold the card for good; flip = you sell at the end of the window. */
  hold: 'keep' | 'flip';
  /** Share of the price lost on a flip (fee + drift), 0–1. */
  flipLoss: number;
  /** Best-combination priority: maximise earnings, or penalise overlap (payout your claim slots can't take). */
  overlapMode: 'earnings' | 'min-overlap';
  /** Don't add a card earning less than this share of its net cost over the window (0–1). */
  minRoi: number;
  /** Rax per rating point (Rateboard's "rate"). */
  rate: number;
  /** OPT-IN (off by default): price each card's rating from its own RaxEdge pack odds instead of the one global rate. Needs imported pack odds. */
  usePackRates: boolean;
  /** Rax per Player pack, used for the pack-odds rate. */
  packPrice: number;
  /** Per-card, per-rung price you saw in-app: id → rung → Rax. */
  overrides: Record<string, Record<string, number>>;
  /** Cards you already own, id → ladder key of the level you hold them at (free, always in the set). */
  ownedLevels: Record<string, string>;
  /** Cards looked up live because they weren't in the snapshot (the snapshot only holds the top cards). */
  customCards: OtdCardRecord[];
  /** Last username pulled in the profile view. */
  username: string;
}

export const DEFAULT_STATE: EffState = {
  method: 'observed',
  preset: '90',
  customDays: 45,
  start: '',
  capLifetime: false,
  proWin: 0.5,
  rarity: 'Iconic',
  autoMin: 'Epic',
  multOverride: 0,
  sports: [],
  budget: 100_000,
  maxCards: 12,
  overlapMode: 'earnings',
  minRoi: 0,
  hold: 'keep',
  flipLoss: 0.1,
  rate: DEFAULT_PRICE_PARAMS.ratePerRating.mid.value,
  usePackRates: false,
  packPrice: DEFAULT_PRICE_PARAMS.pack.playerPackPrice.value,
  overrides: {},
  ownedLevels: {},
  customCards: [],
  username: '',
};

/** Every selectable rung, in ladder order. */
export const RUNG_KEYS: string[] = [...RARITY_LADDER.filter((r) => r.otdEligible).map((r) => r.key), ...ICONIC_LEVELS.map((l) => l.key)];

export const windowYears = (s: EffState) => (s.preset === '5y' ? 5 : s.preset === '10y' ? 10 : 1);
export const windowDays = (s: EffState) => (s.preset === 'custom' ? Math.max(1, Math.min(365, Math.round(s.customDays) || 1)) : s.preset === '5y' || s.preset === '10y' ? 365 : +s.preset);

export function windowStart(s: EffState): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.start);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

export interface Level {
  key: string;
  multiplier: number;
  annualCap: number | null;
  est: PriceEstimate;
}

/** Pack data handed to the pricing: the parsed RaxEdge index (null/empty = none imported). */
export type PackData = PackIndex | null | undefined;

/**
 * Price parameters from UI state. With `usePackRates` ON and pack data for a card in `cards`, that card gets its own
 * Rax-per-rating (shared/raxedgePackOdds.ts) via `rateByCard`; every other card, and everything when the option is off or no
 * data is imported, is priced exactly as before.
 */
export function priceParamsFor(s: EffState, cards?: ReadonlyArray<OtdCardRecord>, pack?: PackData): PriceParams {
  const p = cloneParams();
  p.ratePerRating.mid.value = s.rate;
  p.ratePerRating.low.value = Math.min(s.rate, DEFAULT_PRICE_PARAMS.ratePerRating.low.value);
  p.ratePerRating.high.value = Math.max(s.rate, DEFAULT_PRICE_PARAMS.ratePerRating.high.value);
  p.overrides = s.overrides;
  if (s.usePackRates && pack && pack.size && cards?.length) {
    const rateByCard: NonNullable<PriceParams['rateByCard']> = {};
    for (const c of cards) {
      // shrink toward the card's effective global rate (after sport/owners/premium), so pack and market sides agree
      const g = rateBand({ id: c.id, sport: c.sport, owners: c.owners }, p).mid;
      const r = packRateFor(c, { index: pack, packPrice: s.packPrice, globalRate: g });
      if (r) rateByCard[c.id] = { rate: r.rate, basis: r.basis };
    }
    if (Object.keys(rateByCard).length) p.rateByCard = rateByCard;
  }
  return p;
}

const levelFor = (card: OtdCardRecord, key: string, mult: number, pp: PriceParams): Level | null => {
  const m = mult > 0 ? mult : multiplierFor(key);
  if (m == null) return null;
  const est = estimateCardPrice({ id: card.id, sport: card.sport, season: card.season, name: card.name, annual: card.annual, owners: card.owners }, key, pp);
  return { key, multiplier: m, annualCap: capFor(key), est };
};

/** One level per card: the chosen rung, or (AUTO) whichever rung pays back fastest. */
export function buildLevels(cards: OtdCardRecord[], s: EffState, pack?: PackData): Map<string, Level> {
  const pp = priceParamsFor(s, cards, pack);
  const out = new Map<string, Level>();
  const auto = s.rarity === 'AUTO';
  const from = Math.max(0, RUNG_KEYS.indexOf(s.autoMin));
  const candidates = RUNG_KEYS.slice(from);
  for (const c of cards) {
    const own = s.ownedLevels[c.id];
    if (own && c.fixed) {
      // team card / UFC fighter imported from RaxEdge: its own multiplier and cap, not a ladder rung
      out.set(c.id, { key: c.fixed.label, multiplier: c.fixed.multiplier, annualCap: c.fixed.annualCap, est: { price: 0, low: 0, high: 0, basis: `You own this (${c.fixed.label})`, confidence: 'documented', method: 'override' } });
      continue;
    }
    if (own) {
      const l = levelFor(c, own, 0, pp);
      if (l) out.set(c.id, { ...l, est: { ...l.est, price: 0, low: 0, high: 0, basis: `You own this at ${own}` } });
      continue;
    }
    if (!auto) {
      const l = levelFor(c, s.rarity, s.multOverride, pp);
      if (l) out.set(c.id, l);
      continue;
    }
    let best: Level | null = null;
    let bestScore = -1;
    for (const key of candidates) {
      const l = levelFor(c, key, 0, pp);
      if (!l || l.est.price <= 0) continue;
      const earn = l.annualCap == null ? c.annual * l.multiplier : Math.min(l.annualCap, c.annual * l.multiplier);
      const score = earn / l.est.price;
      if (score > bestScore) (bestScore = score), (best = l);
    }
    if (best) out.set(c.id, best);
  }
  return out;
}

/** Engine parameters from UI state + the per-card levels. `window` overrides the state's timeframe (e.g. one calendar month). */
export function effParams(s: EffState, levels: Map<string, Level>, sportsOn: ReadonlySet<OtdSport>, window?: { start: Date; days: number }): EfficiencyParams {
  return {
    window: window ?? { start: windowStart(s), days: windowDays(s) },
    years: window ? 1 : windowYears(s),
    capLifetime: !window && windowYears(s) > 1 && s.capLifetime,
    claimsPerDay: 2,
    scope: 'per-sport',
    multiplier: 1,
    annualCap: null,
    levelOf: (c) => { const l = levels.get(c.id); return l ? { multiplier: l.multiplier, annualCap: l.annualCap } : { multiplier: 0, annualCap: null }; },
    sports: sportsOn,
    priceOf: (c) => levels.get(c.id)?.est.price ?? 0,
    sunkFraction: s.hold === 'keep' ? 1 : s.flipLoss,
  };
}

/** Snapshot cards plus any the user looked up live (custom cards win on an id clash). */
export function withCustom(base: OtdCardRecord[] | undefined, custom: OtdCardRecord[]): OtdCardRecord[] {
  if (!custom.length) return base ?? [];
  const ids = new Set(custom.map((c) => c.id));
  return [...(base ?? []).filter((c) => !ids.has(c.id)), ...custom];
}
