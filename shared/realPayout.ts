/**
 * Real Sports PREDICTION markets — payout maths for Tab 9 (Edge / EV). Pure.
 *
 * WHAT IS ESTABLISHED (see docs/REAL-PREDICTIONS.md for sources and the open questions):
 *   [documented] Pro-only "prediction market" (beta from 2025-12-20): community-driven markets paid in Rax; the automated
 *                market is "fully peer-to-peer with cashout". Supported markets: game winners and total points (futures /
 *                soccer added 2026). "The percentages shown in markets reflect the likelihood the community thinks something
 *                will happen" and "lower percentages result in higher Rax payouts".
 *   [community]  RaxEdge (third party) computes EV as (fair / RealYes) × (1 − rake) − 1.
 *   [unknown]    the rake / fee (if any), the min/max stake, whether your own stake moves the percentage (an automated market
 *                maker would), the cashout fee, tie / postponement handling.
 *
 * So the model below is the most plausible one consistent with all of that — a YES share priced at the displayed percentage
 * that pays 1 Rax if the side wins — and every undocumented knob is an explicit, user-editable parameter of `RealRules`.
 * NOTHING here claims to be Real's formula; the 2-minute in-app check (docs/REAL-PREDICTIONS.md) calibrates it.
 *
 * Units: fairProb is 0–1. realMarketPct is 0–100 (as the app shows it). evPct returns percent (3.2 = +3.2% of stake).
 */
import type { Confidence, Fact } from './otdRules';

export interface RealRules {
  /** Fee as a fraction (0.05 = 5%). UNKNOWN — placeholder; calibrate with `rakeFromQuote`. */
  rake: number;
  /** Is the rake taken from the whole payout (RaxEdge's formula) or only from the profit? UNKNOWN. */
  rakeBasis: 'payout' | 'profit';
  /**
   * 'fixed': you buy at the displayed percentage regardless of size (peer-to-peer match at the shown price).
   * 'pool':  your stake joins that side's pool, so the percentage — and the payout multiple — move against you (pari-mutuel /
   *          AMM-like). Needs `poolRax`.
   */
  model: 'fixed' | 'pool';
  /** Total Rax in the market (both sides) for the 'pool' model; null = unknown (then the model degrades to 'fixed'). */
  poolRax: number | null;
  /** Smallest / largest single stake in Rax; null = unknown. */
  minStake: number | null;
  maxStake: number | null;
  /** Stakes are rounded DOWN to a multiple of this (1 Rax). */
  stakeStep: number;
}

export const DEFAULT_REAL_RULES: RealRules = {
  rake: 0.05,
  rakeBasis: 'payout',
  model: 'fixed',
  poolRax: null,
  minStake: null,
  maxStake: null,
  stakeStep: 1,
};

const SRC_CHANGELOG = 'https://docs.realapp.link/updates/changelog (Dec 20 2025 entry)';
const SRC_PRO = 'https://docs.realapp.link/basics/real-pro ("Predictions")';
const SRC_RAXEDGE = 'https://raxedge.com (landing page formula; third party, paid)';
const f = <T>(value: T, confidence: Confidence, source: string): Fact<T> => ({ value, confidence, source });

/** Every rule with its confidence, like shared/otdRules.ts. Snapshot 2026-10-11; Real changes things often. */
export const REAL_PREDICTION_FACTS = {
  availability: f('Real Pro members only (beta launched 2025-12-20)', 'documented', SRC_CHANGELOG),
  currency: f('Rax', 'documented', SRC_PRO),
  marketTypes: f(['game winner', 'total points', 'futures', 'soccer'], 'documented', `${SRC_PRO}; changelog Feb/Mar 2026 (futures, soccer, WBC). Spread markets: not documented.`),
  displayedPercentMeaning: f("the community's implied likelihood of that outcome", 'documented', SRC_PRO),
  payoutDirection: f('lower percentage → higher Rax payout', 'documented', SRC_PRO),
  structure: f('automated market, fully peer-to-peer, with cashout', 'documented', SRC_CHANGELOG),
  payoutFormula: f('stake ÷ (percentage/100), less any rake — a share priced at the displayed % pays 1 Rax on a win', 'inferred', `consistent with ${SRC_PRO} + ${SRC_RAXEDGE}`),
  evFormulaUsedByRaxEdge: f('EV = (fair ÷ RealYes) × (1 − rake) − 1', 'community', SRC_RAXEDGE),
  rake: f<number | null>(null, 'unknown', 'RaxEdge uses a rake term but never states the value; Real publishes none. (Arena Rax pots take 10% — a different product.)'),
  rakeBasis: f<'payout' | 'profit' | null>(null, 'unknown', 'RaxEdge applies it to the whole payout ((1/p)(1−rake)); not confirmed'),
  priceImpact: f<boolean | null>(null, 'unknown', '"Automated market" suggests your stake moves the price; size of the effect is unknown'),
  minStake: f<number | null>(null, 'unknown', 'not documented'),
  maxStake: f<number | null>(null, 'unknown', 'not documented (RaxEdge advertises "up to 10,000 Rax per slip" — its own parlay product)'),
  cashout: f('available; value presumably the current market %', 'documented', `${SRC_CHANGELOG} (exists); fee unknown`),
  tiesAndPostponements: f<string | null>(null, 'unknown', 'not documented'),
} as const;

/* ------------------------------------------------------------------ */
/* Payout / EV                                                         */
/* ------------------------------------------------------------------ */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const toP = (pct: number) => clamp(pct / 100, 1e-6, 1 - 1e-6);

/** Net payout multiple per 1 Rax staked INCLUDING the returned stake (e.g. 1.9 = a 1 Rax stake returns 1.9 Rax on a win). */
export function netMultiple(p: number, rules: RealRules): number {
  const gross = 1 / p;
  return rules.rakeBasis === 'profit' ? 1 + (gross - 1) * (1 - rules.rake) : gross * (1 - rules.rake);
}

/**
 * Payout multiple when staking `stake` Rax into a market priced at `realMarketPct`. 'fixed' model (or unknown pool): the
 * displayed price. 'pool' model: the side's pool grows by the stake, so the price you effectively pay is
 * (P + s) / (T + s) with P = side pool, T = total pool.
 */
export function payoutMultiple(realMarketPct: number, rules: RealRules, stake = 0): number {
  const p = toP(realMarketPct);
  if (rules.model === 'pool' && rules.poolRax && rules.poolRax > 0 && stake > 0) {
    const T = rules.poolRax;
    const pEff = (p * T + stake) / (T + stake);
    return netMultiple(clamp(pEff, 1e-6, 1 - 1e-6), rules);
  }
  return netMultiple(p, rules);
}

/** Expected value as a percent of stake from buying the side at Real's displayed percentage. Positive = +EV. */
export function evPct(fairProb: number, realMarketPct: number, rules: RealRules = DEFAULT_REAL_RULES, stake = 0): number {
  if (!(fairProb >= 0 && fairProb <= 1) || !Number.isFinite(realMarketPct)) return NaN;
  return (fairProb * payoutMultiple(realMarketPct, rules, stake) - 1) * 100;
}

/** Highest Real percentage at which buying the side is still ≥ 0 EV (fixed model): buy it if Real shows less than this. */
export function breakEvenPct(fairProb: number, rules: RealRules = DEFAULT_REAL_RULES): number {
  const q = clamp(fairProb, 1e-9, 1 - 1e-9);
  const r = rules.rake;
  const p = rules.rakeBasis === 'profit' ? 1 / (1 + (1 - q) / (q * (1 - r))) : q * (1 - r);
  return p * 100;
}

/** The largest rake at which the side is still ≥ 0 EV at Real's current percentage (payout basis): 1 − p/fair. */
export function maxRakeForBreakeven(fairProb: number, realMarketPct: number, basis: RealRules['rakeBasis'] = 'payout'): number {
  const p = toP(realMarketPct);
  if (fairProb <= 0) return -Infinity;
  if (basis === 'payout') return 1 - p / fairProb;
  const gross = 1 / p;
  return 1 - (1 / fairProb - 1) / (gross - 1);
}

export interface SensitivityRow {
  /** Real's displayed percentage for the side. */
  pct: number;
  /** EV in percent of stake. */
  ev: number;
  /** Net payout multiple at that percentage. */
  multiple: number;
}

/**
 * EV as Real's percentage moves — the pool fills over the game day and your own stake shifts it. Rows run from
 * `pct0 − rangePp` to `pct0 + rangePp` in `step` points. `breakEven` is the percentage where EV crosses zero.
 */
export function sensitivity(
  fairProb: number,
  pct0: number,
  rules: RealRules = DEFAULT_REAL_RULES,
  opts: { rangePp?: number; step?: number; stake?: number } = {},
): { rows: SensitivityRow[]; breakEven: number; evAtPct0: number } {
  const range = opts.rangePp ?? 10;
  const step = opts.step ?? 1;
  const rows: SensitivityRow[] = [];
  for (let x = pct0 - range; x <= pct0 + range + 1e-9; x += step) {
    const pct = Math.round(x * 100) / 100;
    if (pct <= 0.5 || pct >= 99.5) continue;
    rows.push({ pct, ev: evPct(fairProb, pct, rules, opts.stake ?? 0), multiple: payoutMultiple(pct, rules, opts.stake ?? 0) });
  }
  return { rows, breakEven: breakEvenPct(fairProb, rules), evAtPct0: evPct(fairProb, pct0, rules, opts.stake ?? 0) };
}

/** EV% against stake size (meaningful for the 'pool' model; flat for 'fixed'). */
export function stakeSensitivity(fairProb: number, pct: number, rules: RealRules, stakes: number[]): Array<{ stake: number; ev: number; multiple: number; effectivePct: number }> {
  return stakes.map((stake) => {
    const multiple = payoutMultiple(pct, rules, stake);
    const T = rules.poolRax ?? 0;
    const effectivePct = rules.model === 'pool' && T > 0 && stake > 0 ? ((toP(pct) * T + stake) / (T + stake)) * 100 : pct;
    return { stake, ev: (fairProb * multiple - 1) * 100, multiple, effectivePct };
  });
}

/* ------------------------------------------------------------------ */
/* Staking                                                             */
/* ------------------------------------------------------------------ */

/** Full-Kelly fraction of bankroll for win probability `fairProb` at net multiple `payoutMultiple` (stake returned on a win). */
export function kellyFraction(fairProb: number, payoutMultiple: number): number {
  const b = payoutMultiple - 1;
  if (!(b > 0) || !(fairProb > 0)) return 0;
  return Math.max(0, (fairProb * payoutMultiple - 1) / b);
}

/**
 * Fractional-Kelly stake in Rax. `payoutMultiple` is the NET multiple (use `payoutMultiple(...)` / `netMultiple`). Returns 0
 * when there is no edge. `fraction` defaults to a quarter Kelly — fair probabilities from thin markets are noisy.
 */
export function kellyStake(fairProb: number, payoutMultiple: number, bankroll: number, fraction = 0.25): number {
  if (!(bankroll > 0) || !(fraction > 0)) return 0;
  return Math.floor(kellyFraction(fairProb, payoutMultiple) * fraction * bankroll + 1e-9);
}

export interface StakeRecommendation {
  stake: number;
  evPct: number;
  multiple: number;
  /** Full-Kelly fraction of bankroll at the quoted price. */
  kelly: number;
  /** Why the stake is what it is (no edge, capped by the max stake, raised to the minimum, …). */
  note: string;
}

/** Stake to place: fractional Kelly at the displayed price (and, for the 'pool' model, at the price your own stake pushes it to), clamped to the stake limits. */
export function recommendStake(fairProb: number, realMarketPct: number, bankroll: number, rules: RealRules = DEFAULT_REAL_RULES, fraction = 0.25): StakeRecommendation {
  const m0 = payoutMultiple(realMarketPct, rules);
  const kelly = kellyFraction(fairProb, m0);
  const none = (note: string): StakeRecommendation => ({ stake: 0, evPct: evPct(fairProb, realMarketPct, rules), multiple: m0, kelly, note });
  if (!(fairProb * m0 > 1)) return none('No edge at this price (EV ≤ 0).');
  if (!(bankroll > 0)) return none('Set a bankroll.');
  let stake = kelly * fraction * bankroll;
  let note = `${(fraction * 100).toFixed(0)}% Kelly of ${bankroll} Rax.`;
  if (rules.model === 'pool' && rules.poolRax && rules.poolRax > 0) {
    // Shrink the stake until the growth-optimal point under price impact: maximise q·ln(1−s/B+s·m(s)/B)+(1−q)·ln(1−s/B).
    const cap = Math.min(bankroll * 0.5, stake * 4);
    let best = 0;
    let bestG = 0;
    for (let i = 1; i <= 200; i++) {
      const s = (cap * i) / 200;
      const m = payoutMultiple(realMarketPct, rules, s);
      const g = fairProb * Math.log(1 - s / bankroll + (s * m) / bankroll) + (1 - fairProb) * Math.log(1 - s / bankroll);
      if (g > bestG) {
        bestG = g;
        best = s;
      }
    }
    stake = best * fraction;
    note = `${(fraction * 100).toFixed(0)}% of the growth-optimal stake after price impact (pool ${rules.poolRax} Rax).`;
  }
  if (rules.maxStake !== null && stake > rules.maxStake) {
    stake = rules.maxStake;
    note += ' Capped at the max stake.';
  }
  stake = Math.floor(stake / rules.stakeStep + 1e-9) * rules.stakeStep;
  if (rules.minStake !== null && stake < rules.minStake) return none(`Kelly stake is below the ${rules.minStake} Rax minimum — skip or bet the minimum at your own risk.`);
  if (stake <= 0) return none('Edge too small for a whole-Rax stake.');
  const multiple = payoutMultiple(realMarketPct, rules, stake);
  return { stake, evPct: evPct(fairProb, realMarketPct, rules, stake), multiple, kelly, note };
}

/* ------------------------------------------------------------------ */
/* Calibration helpers for the in-app check                            */
/* ------------------------------------------------------------------ */

/**
 * Back out the rake from one in-app quote: you stake `stake` Rax at displayed `pct`, and the app's confirm screen says it
 * would pay `quotedPayout` Rax in total. Payout basis: rake = 1 − quotedPayout·p / stake. Profit basis: rake = 1 − (quotedPayout − stake) / (stake·(1/p − 1)).
 * A small stake keeps price impact out of the number.
 */
export function rakeFromQuote(pct: number, stake: number, quotedPayout: number, basis: RealRules['rakeBasis'] = 'payout'): number {
  const p = toP(pct);
  if (!(stake > 0)) return NaN;
  return basis === 'payout' ? 1 - (quotedPayout * p) / stake : 1 - (quotedPayout - stake) / (stake * (1 / p - 1));
}

/**
 * Given two quotes at the same displayed percentage — a small stake and a large one — estimate the pool size of a
 * pari-mutuel market (T). Each quote's effective price is p_eff = stake·(1−rake)/payout [payout basis]; solving
 * p_eff = (p·T + s)/(T + s) for T. Needs `rake` (from `rakeFromQuote` on the small stake). Returns null if the quotes show no impact.
 */
export function poolFromQuotes(pct: number, rake: number, big: { stake: number; payout: number }): number | null {
  const p = toP(pct);
  const pEff = (big.stake * (1 - rake)) / big.payout;
  if (!(pEff > p) || !(pEff < 1)) return null;
  const T = (big.stake * (1 - pEff)) / (pEff - p);
  return Number.isFinite(T) && T > 0 ? T : null;
}
