/**
 * OTD efficiency engine (Tab 7) — pure functions, shared by the browser and tests.
 *
 * Model: a card pays `multiplier × rax` on each anniversary of its games. Each day, only the top `claimsPerDay`
 * payouts among the cards you hold can be claimed (per sport, or across all sports if the rule is global). So a
 * card's real value depends on what else you own — overlaps waste claims. `rankCards` scores every card on its own;
 * `buildPortfolio` picks cards greedily by *marginal* gain per Rax of cost, which handles overlaps exactly.
 *
 * Approximations (surfaced in the UI): a rarity cap is applied to each card as a uniform scale factor
 * (cap ÷ uncapped annual) rather than tracking which claims actually landed; Feb 29 games are ignored in non-leap
 * windows; prices come from a caller-supplied function and are estimates.
 */
import type { OtdCardRecord, OtdSport } from './otdSnapshot';

export interface WindowSpec {
  /** First day of the window (UTC date). */
  start: Date;
  /** Number of days, 1–365 (a longer window would count the same anniversary twice). */
  days: number;
}

export interface EfficiencyParams {
  window: WindowSpec;
  /** Claims per day (2 non-Pro, 3 Pro). */
  claimsPerDay: number;
  scope: 'per-sport' | 'global';
  /** Rarity multiplier over General-level rax (Iconic = 150). */
  multiplier: number;
  /** Max Rax one card can earn per year at this rarity; null = uncapped. */
  annualCap: number | null;
  /** Per-card override of multiplier/cap (e.g. "best rung per card"). When set, `multiplier`/`annualCap` are ignored. */
  levelOf?: (card: OtdCardRecord) => { multiplier: number; annualCap: number | null };
  sports: ReadonlySet<OtdSport>;
  /** Price to buy one card at the target rarity, in Rax. */
  priceOf: (card: OtdCardRecord) => number;
  /**
   * Fraction of the price you don't get back. 1 = you keep the card forever (full cost counted against the window);
   * <1 = you sell at the end (e.g. 0.1 marketplace fee + any price drift).
   */
  sunkFraction: number;
}

const DAY_MS = 86_400_000;

/** Payout per General-level rax for this card: multiplier × cap scale. */
export function payoutScale(card: OtdCardRecord, p: Pick<EfficiencyParams, 'multiplier' | 'annualCap' | 'levelOf'>): number {
  const l = p.levelOf ? p.levelOf(card) : { multiplier: p.multiplier, annualCap: p.annualCap };
  return l.multiplier * capFactor(card, l.multiplier, l.annualCap);
}

/** The mmdd of every day in the window, in order. */
export function windowKeys(w: WindowSpec): number[] {
  const out: number[] = [];
  const n = Math.max(1, Math.min(365, Math.floor(w.days)));
  const t0 = Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth(), w.start.getUTCDate());
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + i * DAY_MS);
    out.push((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
  }
  return out;
}

/** Cap as a uniform scale on a card's payouts: min(1, cap / uncappedAnnual). */
export function capFactor(card: OtdCardRecord, multiplier: number, annualCap: number | null): number {
  if (annualCap == null) return 1;
  const raw = card.annual * multiplier;
  return raw > annualCap ? annualCap / raw : 1;
}

export interface CardRow {
  card: OtdCardRecord;
  price: number;
  /** Payout if you claimed every anniversary of this card inside the window (ignores overlaps). */
  windowEarn: number;
  /** Same for a full year. */
  annualEarn: number;
  /** Anniversaries inside the window. */
  windowGames: number;
  /** windowEarn ÷ (price × sunkFraction); Infinity-safe. */
  roi: number;
  /** price ÷ (annualEarn / 365). */
  paybackDays: number;
  capped: boolean;
}

export function rankCards(cards: OtdCardRecord[], p: EfficiencyParams): CardRow[] {
  const keys = new Set(windowKeys(p.window));
  const rows: CardRow[] = [];
  for (const card of cards) {
    if (!p.sports.has(card.sport)) continue;
    const scale = payoutScale(card, p);
    const f = scale / (p.levelOf ? p.levelOf(card).multiplier : p.multiplier) || 0;
    let w = 0;
    let wg = 0;
    let a = 0;
    for (const [d, rax] of card.days) {
      a += rax;
      if (keys.has(d)) {
        w += rax;
        wg++;
      }
    }
    // `days` is truncated to games ≥ minDayRax, so take the card's true annual when it's larger.
    const annualGeneral = Math.max(card.annual, a);
    const price = Math.max(0, p.priceOf(card));
    const windowEarn = w * scale;
    const annualEarn = annualGeneral * scale;
    const sunk = price * p.sunkFraction;
    rows.push({
      card,
      price,
      windowEarn,
      annualEarn,
      windowGames: wg,
      roi: sunk > 0 ? windowEarn / sunk : windowEarn > 0 ? Infinity : 0,
      paybackDays: annualEarn > 0 ? price / (annualEarn / 365) : Infinity,
      capped: f < 1,
    });
  }
  return rows;
}

/* ------------------------------ portfolio ------------------------------ */

export interface PortfolioPick {
  row: CardRow;
  /** Extra earnings this card adds in the window given the cards chosen before it. */
  marginal: number;
  /** Cost counted against the window (price × sunkFraction). */
  netCost: number;
  /** marginal ÷ netCost. */
  marginalRoi: number;
  cumEarn: number;
  cumPrice: number;
  cumNetCost: number;
}

export interface DayCell {
  mmdd: number;
  /** Sport key or 'ALL' when the scope is global. */
  pool: string;
  /** Payouts of the held cards that day, best first. */
  payouts: Array<{ cardId: string; value: number }>;
  claimed: number;
  /** Payout value that falls outside the claim limit — wasted. */
  wasted: number;
  /** Claim slots with nothing to claim. */
  emptySlots: number;
}

export interface Portfolio {
  picks: PortfolioPick[];
  totalEarn: number;
  totalPrice: number;
  totalNetCost: number;
  /** Day-by-day outcome for the chosen set, in window order. */
  calendar: DayCell[];
  /** Σ wasted across the window. */
  wasted: number;
  /** Σ empty slots across the window (days × pools you could still fill). */
  emptySlots: number;
  stoppedBecause: 'budget' | 'count' | 'no-gain' | 'candidates';
}

export interface PortfolioOptions {
  /** Total Rax to spend (Infinity = no limit). */
  budget: number;
  /** Max cards to buy. */
  maxCards: number;
  /** Stop when the best remaining marginal ROI falls below this (earn per Rax of net cost over the window). */
  minMarginalRoi: number;
  /** Cards already held (cost 0, always in the set, listed first). */
  ownedIds?: ReadonlySet<string>;
  /** Ignore cards pricier than this. */
  maxPricePerCard?: number;
}

const poolOf = (p: EfficiencyParams, sport: OtdSport) => (p.scope === 'global' ? 'ALL' : sport);

/** Value-per-slot structure: for each pool|mmdd, the best `claimsPerDay` payouts of the chosen cards. */
class SlotBoard {
  private m = new Map<string, number[]>();
  constructor(private cap: number) {}
  private k = (pool: string, d: number) => `${pool}|${d}`;
  /** Gain from adding value v to that slot. */
  gain(pool: string, d: number, v: number): number {
    const a = this.m.get(this.k(pool, d));
    if (!a || a.length < this.cap) return v;
    const worst = a[a.length - 1];
    return v > worst ? v - worst : 0;
  }
  add(pool: string, d: number, v: number) {
    const key = this.k(pool, d);
    const a = this.m.get(key) ?? [];
    a.push(v);
    a.sort((x, y) => y - x);
    if (a.length > this.cap) a.length = this.cap;
    this.m.set(key, a);
  }
}

interface PreparedCard {
  row: CardRow;
  pool: string;
  /** [mmdd, payout] for in-window days, payout already × payoutScale. */
  hits: Array<[number, number]>;
}

function prepare(rows: CardRow[], p: EfficiencyParams): PreparedCard[] {
  const keys = new Set(windowKeys(p.window));
  return rows.map((row) => {
    const scale = payoutScale(row.card, p);
    const hits: Array<[number, number]> = [];
    for (const [d, rax] of row.card.days) if (keys.has(d)) hits.push([d, rax * scale]);
    return { row, pool: poolOf(p, row.card.sport), hits };
  });
}

export function buildPortfolio(cards: OtdCardRecord[], p: EfficiencyParams, o: PortfolioOptions): Portfolio {
  const rows = rankCards(cards, p);
  const prepared = prepare(rows, p);
  const board = new SlotBoard(p.claimsPerDay);
  const picks: PortfolioPick[] = [];
  const chosen = new Set<string>();
  let cumEarn = 0;
  let cumPrice = 0;
  let cumNet = 0;
  let spent = 0;
  const owned = o.ownedIds ?? new Set<string>();
  let ownedCount = 0;

  const commit = (pc: PreparedCard, marginal: number, price: number) => {
    for (const [d, v] of pc.hits) board.add(pc.pool, d, v);
    chosen.add(pc.row.card.id);
    const netCost = price * p.sunkFraction;
    cumEarn += marginal;
    cumPrice += price;
    cumNet += netCost;
    picks.push({ row: pc.row, marginal, netCost, marginalRoi: netCost > 0 ? marginal / netCost : marginal > 0 ? Infinity : 0, cumEarn, cumPrice, cumNetCost: cumNet });
  };

  for (const pc of prepared) {
    if (owned.has(pc.row.card.id)) {
      let g = 0;
      for (const [d, v] of pc.hits) g += board.gain(pc.pool, d, v);
      commit(pc, g, 0);
      ownedCount++;
    }
  }

  let stoppedBecause: Portfolio['stoppedBecause'] = 'candidates';
  const maxPrice = o.maxPricePerCard ?? Infinity;
  while (picks.length - ownedCount < o.maxCards) {
    let best: { pc: PreparedCard; gain: number; score: number } | null = null;
    let anyAffordable = false;
    for (const pc of prepared) {
      if (chosen.has(pc.row.card.id)) continue;
      const price = pc.row.price;
      if (price > maxPrice || spent + price > o.budget) continue;
      anyAffordable = true;
      let g = 0;
      for (const [d, v] of pc.hits) g += board.gain(pc.pool, d, v);
      if (g <= 0) continue;
      const net = price * p.sunkFraction;
      const score = net > 0 ? g / net : 1e12 + g; // free cards first, biggest gain first
      if (!best || score > best.score) best = { pc, gain: g, score };
    }
    if (!best) {
      stoppedBecause = anyAffordable ? 'no-gain' : 'budget';
      break;
    }
    if (best.score < o.minMarginalRoi) {
      stoppedBecause = 'no-gain';
      break;
    }
    commit(best.pc, best.gain, best.pc.row.price);
    spent += best.pc.row.price;
    if (picks.length - ownedCount >= o.maxCards) stoppedBecause = 'count';
  }

  const calendar = buildCalendar(picks.map((x) => x.row.card), p);
  return {
    picks,
    totalEarn: calendar.reduce((s, c) => s + c.claimed, 0),
    totalPrice: cumPrice,
    totalNetCost: cumNet,
    calendar,
    wasted: calendar.reduce((s, c) => s + c.wasted, 0),
    emptySlots: calendar.reduce((s, c) => s + c.emptySlots, 0),
    stoppedBecause,
  };
}

/** Day-by-day result of holding exactly `cards`. */
export function buildCalendar(cards: OtdCardRecord[], p: EfficiencyParams): DayCell[] {
  const keys = windowKeys(p.window);
  const pools = p.scope === 'global' ? ['ALL'] : [...p.sports];
  const by = new Map<string, Array<{ cardId: string; value: number }>>();
  const keySet = new Set(keys);
  for (const c of cards) {
    const scale = payoutScale(c, p);
    const pool = poolOf(p, c.sport);
    for (const [d, rax] of c.days) {
      if (!keySet.has(d)) continue;
      const k = `${pool}|${d}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push({ cardId: c.id, value: rax * scale });
    }
  }
  const cells: DayCell[] = [];
  for (const d of keys) {
    for (const pool of pools) {
      const list = (by.get(`${pool}|${d}`) ?? []).sort((a, b) => b.value - a.value);
      const claimed = list.slice(0, p.claimsPerDay).reduce((s, x) => s + x.value, 0);
      const wasted = list.slice(p.claimsPerDay).reduce((s, x) => s + x.value, 0);
      cells.push({ mmdd: d, pool, payouts: list, claimed, wasted, emptySlots: Math.max(0, p.claimsPerDay - list.length) });
    }
  }
  return cells;
}

/* ------------------------------ calendar heat ------------------------------ */

export interface SportCeiling {
  sport: OtdSport;
  /** For each window day: best achievable claimed payout if you held EVERY card (the ceiling), General-level × multiplier. */
  perDay: number[];
  total: number;
  /** Days in the window where this sport has any claim at all. */
  activeDays: number;
}

/** What each sport could possibly pay in the window — shows which sports are "coming up" vs. quiet. */
export function sportCeilings(cards: OtdCardRecord[], p: EfficiencyParams): SportCeiling[] {
  const keys = windowKeys(p.window);
  const idx = new Map<number, number[]>();
  keys.forEach((k, i) => (idx.get(k) ?? idx.set(k, []).get(k)!).push(i));
  const out: SportCeiling[] = [];
  for (const sport of p.sports) {
    const slot = new Map<number, number[]>(); // mmdd -> top payouts
    for (const c of cards) {
      if (c.sport !== sport) continue;
      const scale = payoutScale(c, p);
      for (const [d, rax] of c.days) {
        if (!idx.has(d)) continue;
        const a = slot.get(d) ?? [];
        a.push(rax * scale);
        a.sort((x, y) => y - x);
        if (a.length > p.claimsPerDay) a.length = p.claimsPerDay;
        slot.set(d, a);
      }
    }
    const perDay = keys.map((k) => (slot.get(k) ?? []).reduce((s, v) => s + v, 0));
    out.push({ sport, perDay, total: perDay.reduce((s, v) => s + v, 0), activeDays: perDay.filter((v) => v > 0).length });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Calendar-day label like "Nov 4". */
export const dayLabel = (mmdd: number) =>
  `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.floor(mmdd / 100) - 1]} ${mmdd % 100}`;

/**
 * Expected value of Pro's bonus claim: one extra claim per day across ALL sports, only if you win the poll you place
 * it on. Each day it takes the best payout the per-sport limit left on the table; `winProbability` scales it.
 */
export function proBonusValue(cards: OtdCardRecord[], p: EfficiencyParams, winProbability: number): { value: number; days: number } {
  const cal = buildCalendar(cards, p);
  const bestLeft = new Map<number, number>();
  for (const cell of cal) {
    const next = cell.payouts[p.claimsPerDay];
    if (next && next.value > (bestLeft.get(cell.mmdd) ?? 0)) bestLeft.set(cell.mmdd, next.value);
  }
  let v = 0;
  for (const x of bestLeft.values()) v += x;
  return { value: v * winProbability, days: bestLeft.size };
}
