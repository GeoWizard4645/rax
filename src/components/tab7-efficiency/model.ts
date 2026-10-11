/** Glue between the snapshot, Real's rarity rules and the price model: one "level" (rung + price) per card. */
import { ICONIC_LEVELS, RARITY_LADDER, capFor, multiplierFor } from '../../../shared/otdRules';
import { cloneParams, DEFAULT_PRICE_PARAMS, estimateCardPrice, type PriceEstimate, type PriceParams } from '../../../shared/otdPricing';
import type { OtdCardRecord, OtdSport } from '../../../shared/otdSnapshot';

export type WindowPreset = '7' | '30' | '90' | '180' | '365' | 'custom';

export interface EffState {
  method: 'observed' | 'modeled';
  preset: WindowPreset;
  customDays: number;
  /** ISO date (YYYY-MM-DD) the window starts. '' = today. */
  start: string;
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
  /** Rax per rating point (Rateboard's "rate"). */
  rate: number;
  /** Per-card, per-rung price you saw in-app: id → rung → Rax. */
  overrides: Record<string, Record<string, number>>;
  /** Ids of cards you already own (free, in the set). */
  owned: string[];
}

export const DEFAULT_STATE: EffState = {
  method: 'observed',
  preset: '90',
  customDays: 45,
  start: '',
  proWin: 0.5,
  rarity: 'Iconic',
  autoMin: 'Epic',
  multOverride: 0,
  sports: [],
  budget: 100_000,
  maxCards: 12,
  hold: 'keep',
  flipLoss: 0.1,
  rate: DEFAULT_PRICE_PARAMS.ratePerRating.mid.value,
  overrides: {},
  owned: [],
};

/** Every selectable rung, in ladder order. */
export const RUNG_KEYS: string[] = [...RARITY_LADDER.filter((r) => r.otdEligible).map((r) => r.key), ...ICONIC_LEVELS.map((l) => l.key)];

export const windowDays = (s: EffState) => (s.preset === 'custom' ? Math.max(1, Math.min(365, Math.round(s.customDays) || 1)) : +s.preset);

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

export function priceParamsFor(s: EffState): PriceParams {
  const p = cloneParams();
  p.ratePerRating.mid.value = s.rate;
  p.ratePerRating.low.value = Math.min(s.rate, DEFAULT_PRICE_PARAMS.ratePerRating.low.value);
  p.ratePerRating.high.value = Math.max(s.rate, DEFAULT_PRICE_PARAMS.ratePerRating.high.value);
  p.overrides = s.overrides;
  return p;
}

const levelFor = (card: OtdCardRecord, key: string, mult: number, pp: PriceParams): Level | null => {
  const m = mult > 0 ? mult : multiplierFor(key);
  if (m == null) return null;
  const est = estimateCardPrice({ id: card.id, sport: card.sport, season: card.season, name: card.name, annual: card.annual, owners: card.owners }, key, pp);
  return { key, multiplier: m, annualCap: capFor(key), est };
};

/** One level per card: the chosen rung, or (AUTO) whichever rung pays back fastest. */
export function buildLevels(cards: OtdCardRecord[], s: EffState): Map<string, Level> {
  const pp = priceParamsFor(s);
  const out = new Map<string, Level>();
  const auto = s.rarity === 'AUTO';
  const from = Math.max(0, RUNG_KEYS.indexOf(s.autoMin));
  const candidates = RUNG_KEYS.slice(from);
  for (const c of cards) {
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
