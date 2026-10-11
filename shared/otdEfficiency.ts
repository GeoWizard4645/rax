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
  /** Number of days, 1–366 (windows never repeat an anniversary: a year-long window ends before it would). */
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
  /**
   * Extra claims per day across ALL sports (Pro's bonus claim — Real grants it only if you win its poll, so this is the
   * best case). Each day it takes the best payout the per-sport limit left unclaimed. 0 = none.
   */
  bonusPerDay?: number;
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

/**
 * The mmdd of every day in the window, in order. At most 366 days, and it stops before an mmdd would repeat, so a
 * calendar year gives 365 keys (366 in a leap year) and a longer window never counts an anniversary twice.
 */
export function windowKeys(w: WindowSpec): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const n = Math.max(1, Math.min(366, Math.floor(w.days)));
  const t0 = Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth(), w.start.getUTCDate());
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + i * DAY_MS);
    const k = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (seen.has(k)) break;
    seen.add(k);
    out.push(k);
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
  /** Extra objective value this card adds given the cards before it (earnings; in min-overlap mode net of overlap waste). */
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
  payouts: Array<{ cardId: string; value: number; bonus?: boolean }>;
  claimed: number;
  /** Part of `claimed` that came from the Pro bonus claim. */
  bonus: number;
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
  /** The value the optimizer maximised: earnings − overlapPenalty × wasted. */
  objective: number;
  /** Objective of the plain greedy pass, before local-search refinement (≤ `objective`). */
  greedyObjective: number;
  mode: OverlapMode;
}

/**
 * 'earnings'    — maximise claimable payout; overlaps only matter through the claims they cost you.
 * 'min-overlap' — payout your cards can't claim (the sport's daily slots are already taken) counts AGAINST the set, so it
 *                 prefers cards covering different days even when that costs some total.
 */
export type OverlapMode = 'earnings' | 'min-overlap';

export interface PortfolioOptions {
  /** Total Rax to spend (Infinity = no limit). */
  budget: number;
  /** Max cards to buy. */
  maxCards: number;
  /** Don't add a card whose extra earnings ÷ net cost is below this (earn per Rax of net cost over the window). */
  minMarginalRoi: number;
  /** Cards already held (cost 0, always in the set, listed first). */
  ownedIds?: ReadonlySet<string>;
  /** Ignore cards pricier than this. */
  maxPricePerCard?: number;
  /** Default 'earnings'. */
  overlapMode?: OverlapMode;
  /** Weight of wasted payout in 'min-overlap' mode (default 1). Ignored in 'earnings' mode. */
  overlapPenalty?: number;
  /** Run add / drop / swap local search after the greedy passes (default true). */
  refine?: boolean;
  /** Extra iterated-local-search restarts on top of the default (testing / "think harder"). */
  extraIterations?: number;
  /** Seed for the restarts' randomness (default fixed → reproducible). */
  seed?: number;
}

const poolOf = (p: EfficiencyParams, sport: OtdSport) => (p.scope === 'global' ? 'ALL' : sport);

interface Entry {
  i: number;
  v: number;
}
interface SlotState {
  list: Entry[]; // best first
  top: number;
  total: number;
}

/** Per-(pool, day) claim slots holding every chosen card's payout, with O(1) marginal-gain queries. */
class SlotBoard {
  private m = new Map<number, SlotState>();
  constructor(private cap: number, private lambda: number) {}
  private f(top: number, total: number) {
    return top - this.lambda * (total - top);
  }
  private slot(k: number): SlotState {
    let s = this.m.get(k);
    if (!s) this.m.set(k, (s = { list: [], top: 0, total: 0 }));
    return s;
  }
  /** Change in objective from adding value v to slot k. */
  gain(k: number, v: number): number {
    const s = this.m.get(k);
    if (!s) return this.f(v, v);
    const C = this.cap;
    let top = s.top;
    if (s.list.length < C) top += v;
    else if (v > s.list[C - 1].v) top += v - s.list[C - 1].v;
    return this.f(top, s.total + v) - this.f(s.top, s.total);
  }
  add(k: number, e: Entry) {
    const s = this.slot(k);
    let lo = 0;
    while (lo < s.list.length && s.list[lo].v >= e.v) lo++;
    s.list.splice(lo, 0, e);
    s.total += e.v;
    s.top = 0;
    for (let j = 0; j < Math.min(this.cap, s.list.length); j++) s.top += s.list[j].v;
  }
  remove(k: number, i: number) {
    const s = this.m.get(k);
    if (!s) return;
    const at = s.list.findIndex((x) => x.i === i);
    if (at < 0) return;
    s.total -= s.list[at].v;
    s.list.splice(at, 1);
    s.top = 0;
    for (let j = 0; j < Math.min(this.cap, s.list.length); j++) s.top += s.list[j].v;
  }
  /** Σ objective over all slots. */
  value(): number {
    let t = 0;
    for (const s of this.m.values()) t += this.f(s.top, s.total);
    return t;
  }
}

interface Prepared {
  row: CardRow;
  /** Slot keys (pool index × 1000 + mmdd) and payouts for in-window days. */
  hits: Array<[number, number]>;
  price: number;
  net: number;
}

function prepare(rows: CardRow[], p: EfficiencyParams): Prepared[] {
  const keys = new Set(windowKeys(p.window));
  const poolIdx = new Map<string, number>();
  return rows.map((row) => {
    const scale = payoutScale(row.card, p);
    const pool = poolOf(p, row.card.sport);
    if (!poolIdx.has(pool)) poolIdx.set(pool, poolIdx.size + 1);
    const base = poolIdx.get(pool)! * 10_000;
    const hits: Array<[number, number]> = [];
    for (const [d, rax] of row.card.days) if (keys.has(d)) hits.push([base + d, rax * scale]);
    return { row, hits, price: row.price, net: row.price * p.sunkFraction };
  });
}

export function buildPortfolio(cards: OtdCardRecord[], p: EfficiencyParams, o: PortfolioOptions): Portfolio {
  const mode: OverlapMode = o.overlapMode ?? 'earnings';
  const lambda = mode === 'min-overlap' ? o.overlapPenalty ?? 1 : 0;
  const maxPrice = o.maxPricePerCard ?? Infinity;
  const owned = o.ownedIds ?? new Set<string>();
  const prepared = prepare(rankCards(cards, p), p);
  const ownedIdx = prepared.map((x, i) => (owned.has(x.row.card.id) ? i : -1)).filter((i) => i >= 0);
  for (const i of ownedIdx) (prepared[i].price = 0), (prepared[i].net = 0); // already held: free
  let cand = prepared.map((_x, i) => i).filter((i) => !owned.has(prepared[i].row.card.id) && prepared[i].price <= maxPrice && prepared[i].hits.length > 0);

  type Set_ = { board: SlotBoard; chosen: Set<number>; spent: number };
  const fresh = (): Set_ => {
    const board = new SlotBoard(p.claimsPerDay, lambda);
    for (const i of ownedIdx) for (const [k, v] of prepared[i].hits) board.add(k, { i, v });
    return { board, chosen: new Set<number>(), spent: 0 };
  };
  const gainOf = (st: Set_, i: number) => {
    let g = 0;
    for (const [k, v] of prepared[i].hits) g += st.board.gain(k, v);
    return g;
  };
  const addTo = (st: Set_, i: number) => {
    for (const [k, v] of prepared[i].hits) st.board.add(k, { i, v });
    st.chosen.add(i);
    st.spent += prepared[i].price;
  };
  const removeFrom = (st: Set_, i: number) => {
    for (const [k] of prepared[i].hits) st.board.remove(k, i);
    st.chosen.delete(i);
    st.spent -= prepared[i].price;
  };
  const fits = (st: Set_, i: number) => st.spent + prepared[i].price <= o.budget && st.chosen.size < o.maxCards;
  const passesRoi = (g: number, i: number) => {
    const net = prepared[i].net;
    return g > 1e-9 && (net > 0 ? g / net >= o.minMarginalRoi : true);
  };

  /** Greedy pass: `byRatio` picks max gain per cost, otherwise max absolute gain. */
  const greedy = (byRatio: boolean, start?: Set_, noise?: () => number): Set_ => {
    const st = start ?? fresh();
    for (;;) {
      let best = -1;
      let bestScore = -Infinity;
      for (const i of cand) {
        if (st.chosen.has(i) || !fits(st, i)) continue;
        const g = gainOf(st, i);
        if (!passesRoi(g, i)) continue;
        const net = prepared[i].net;
        const raw = byRatio ? (net > 0 ? g / net : 1e12 + g) : g;
        const score = noise ? raw * (0.55 + 0.9 * noise()) : raw; // randomised in iterated local search only
        if (score > bestScore) (bestScore = score), (best = i);
      }
      if (best < 0) return st;
      addTo(st, best);
    }
  };

  /** Add / drop / swap hill-climbing on the objective, within budget and count. */
  const refine = (st: Set_) => {
    const EPS = 1e-6;
    for (let iter = 0; iter < 60; iter++) {
      const base = st.board.value();
      let improved = false;
      // 1) best single add
      let bestAdd = -1;
      let bestAddGain = EPS;
      for (const i of cand) {
        if (st.chosen.has(i) || !fits(st, i)) continue;
        const g = gainOf(st, i);
        if (passesRoi(g, i) && g > bestAddGain) (bestAddGain = g), (bestAdd = i);
      }
      if (bestAdd >= 0) { addTo(st, bestAdd); continue; }
      // 2) drop a card that hurts the objective (min-overlap) or misses the ROI floor
      for (const i of [...st.chosen]) {
        removeFrom(st, i);
        const loss = base - st.board.value();
        const net = prepared[i].net;
        if (loss < -EPS || (net > 0 && loss / net < o.minMarginalRoi && loss < base)) { improved = true; break; }
        addTo(st, i);
      }
      if (improved) continue;
      // 3) best swap (out i, in j)
      let bestSwap: [number, number] | null = null;
      let bestVal = base + EPS;
      for (const i of [...st.chosen]) {
        removeFrom(st, i);
        const afterOut = st.board.value();
        for (const j of cand) {
          if (st.chosen.has(j) || j === i) continue;
          if (st.spent + prepared[j].price > o.budget) continue;
          const g = gainOf(st, j);
          if (afterOut + g > bestVal) {
            const net = prepared[j].net;
            if (net > 0 && g / net < o.minMarginalRoi) continue;
            bestVal = afterOut + g;
            bestSwap = [i, j];
          }
        }
        addTo(st, i);
      }
      if (bestSwap) { removeFrom(st, bestSwap[0]); addTo(st, bestSwap[1]); improved = true; }
      if (!improved) return;
    }
  };

  const doRefine = o.refine !== false;
  const better = (a: Set_, b: Set_) => {
    const va = a.board.value();
    const vb = b.board.value();
    return vb > va + 1e-6 || (Math.abs(vb - va) <= 1e-6 && b.spent < a.spent) ? b : a;
  };
  const runs = [greedy(true), greedy(false)];
  const greedyObjective = Math.max(...runs.map((r) => r.board.value()));
  let winner = runs[0];
  if (doRefine) {
    for (const r of runs) refine(r);
    winner = better(runs[0], runs[1]);

    // Iterated local search: knock out 1–3 chosen cards, re-fill greedily, re-refine, keep if better. Runs on a shortlist
    // so it stays fast with thousands of candidates. Seeded, so results are reproducible.
    const full = cand;
    if (cand.length > 420) {
      const byAbs = [...cand].sort((a, b) => prepared[b].hits.reduce((s, h) => s + h[1], 0) - prepared[a].hits.reduce((s, h) => s + h[1], 0));
      const byGain = [...cand].map((i) => [i, winner.chosen.has(i) ? 0 : gainOf(winner, i) / Math.max(1, prepared[i].net)] as const).sort((a, b) => b[1] - a[1]);
      cand = [...new Set([...byAbs.slice(0, 140), ...byGain.slice(0, 220).map((x) => x[0]), ...winner.chosen])];
    }
    let seed = o.seed ?? 0x9e3779b9;
    const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 2 ** 32);
    const rebuild = (idx: number[]) => {
      const st = fresh();
      for (const i of idx) addTo(st, i);
      return st;
    };
    const iters = Math.min(80, 20 + winner.chosen.size * 4) + Math.max(0, o.extraIterations ?? 0);
    for (let t = 0; t < iters && winner.chosen.size > 0; t++) {
      const pool = [...winner.chosen];
      const k = Math.min(pool.length, 1 + Math.floor(rnd() * 3));
      for (let j = 0; j < k; j++) pool.splice(Math.floor(rnd() * pool.length), 1);
      const st = greedy(rnd() < 0.5, rebuild(pool), rnd);
      refine(st);
      winner = better(winner, st);
    }
    cand = full;
  }
  const objective = winner.board.value();

  // Replay the chosen set in a sensible order (owned first, then by marginal ÷ cost) for the table.
  const order: number[] = [...ownedIdx];
  const replay = new SlotBoard(p.claimsPerDay, lambda);
  const margin = new Map<number, number>();
  const put = (i: number) => {
    let g = 0;
    for (const [k, v] of prepared[i].hits) g += replay.gain(k, v);
    margin.set(i, g);
    for (const [k, v] of prepared[i].hits) replay.add(k, { i, v });
  };
  ownedIdx.forEach(put);
  const left = new Set(winner.chosen);
  while (left.size) {
    let best = -1;
    let bs = -Infinity;
    for (const i of left) {
      let g = 0;
      for (const [k, v] of prepared[i].hits) g += replay.gain(k, v);
      const net = prepared[i].net;
      const sc = net > 0 ? g / net : 1e12 + g;
      if (sc > bs) (bs = sc), (best = i);
    }
    left.delete(best);
    order.push(best);
    put(best);
  }

  const picks: PortfolioPick[] = [];
  let cumEarn = 0;
  let cumPrice = 0;
  let cumNet = 0;
  for (const i of order) {
    const pr = prepared[i];
    const m = margin.get(i) ?? 0;
    cumEarn += m;
    cumPrice += pr.price;
    cumNet += pr.net;
    picks.push({ row: pr.row, marginal: m, netCost: pr.net, marginalRoi: pr.net > 0 ? m / pr.net : m > 0 ? Infinity : 0, cumEarn, cumPrice, cumNetCost: cumNet });
  }

  // Why did it stop?
  let stoppedBecause: Portfolio['stoppedBecause'] = 'candidates';
  if (cand.length) {
    let anyGain = false;
    let anyAffordable = false;
    for (const i of cand) {
      if (winner.chosen.has(i)) continue;
      if (gainOf(winner, i) <= 1e-9) continue;
      anyGain = true;
      if (winner.spent + prepared[i].price <= o.budget) anyAffordable = true;
    }
    stoppedBecause = winner.chosen.size >= o.maxCards && anyGain ? 'count' : anyGain && !anyAffordable ? 'budget' : anyGain ? 'count' : 'no-gain';
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
    objective,
    greedyObjective,
    mode,
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
      cells.push({ mmdd: d, pool, payouts: list, claimed, bonus: 0, wasted, emptySlots: Math.max(0, p.claimsPerDay - list.length) });
    }
  }
  const nBonus = Math.max(0, Math.floor(p.bonusPerDay ?? 0));
  if (nBonus > 0) {
    const byDay = new Map<number, DayCell[]>();
    for (const c of cells) (byDay.get(c.mmdd) ?? byDay.set(c.mmdd, []).get(c.mmdd)!).push(c);
    for (const group of byDay.values()) {
      const left: Array<{ cell: DayCell; at: number; value: number }> = [];
      for (const cell of group) cell.payouts.forEach((x, at) => at >= p.claimsPerDay && left.push({ cell, at, value: x.value }));
      left.sort((a, b) => b.value - a.value);
      for (const l of left.slice(0, nBonus)) {
        l.cell.payouts[l.at].bonus = true;
        l.cell.claimed += l.value;
        l.cell.bonus += l.value;
        l.cell.wasted -= l.value;
      }
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
