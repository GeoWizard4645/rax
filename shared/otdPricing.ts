/**
 * Tab 7 (OTD Efficiency) — the COST side: what a card at a given rarity costs, what packs cost, and what pack swaps do
 * to that cost. Pure functions + a fully editable parameter object; no fetching. Research notes with sources live in
 * docs/OTD-MARKET.md — every default below carries a `source` + `confidence` and an `estimate` flag where it is a guess.
 *
 * THE MODEL IN ONE PARAGRAPH
 * A Player card is claimed at General level for ~200 Rax (documented). It levels up by collecting Play cards for the
 * same player + season: the ladder is defined by *total card rating* (Common 10 … Iconic 1 = 3,380 … Iconic 20 = 40,000,
 * documented in Real's player-cards doc). Play cards trade at "rating x rate" (Rateboard's unit: Rax per rating point), so
 *     price(target) = claimCost + totalRating(target) x ratePerRating
 * which is documented structure (the ladder) times an *estimated* rate (Rateboard offers: median 10, floor 8, p90 ~25-30).
 * No public source quotes per-rarity marketplace medians, so `rarityAnchors` and `pricePerAnnualRax` default to null — put
 * numbers you see in-app there and they take over.
 *
 * Units: Rax. Fees are fractions (0.10 = 10%).
 */

export type PriceConfidence = 'documented' | 'community' | 'inferred' | 'unknown';

/** A number (or null = "not established") with its provenance. */
export interface Sourced<T> {
  value: T;
  confidence: PriceConfidence;
  source: string;
  /** True when the value is a working guess, not an observation. The UI should badge these. */
  estimate?: boolean;
}

const doc = <T,>(value: T, source: string): Sourced<T> => ({ value, confidence: 'documented', source });
const comm = <T,>(value: T, source: string, estimate = false): Sourced<T> => ({ value, confidence: 'community', source, estimate });
const infer = <T,>(value: T, source: string): Sourced<T> => ({ value, confidence: 'inferred', source, estimate: true });
const unk = <T,>(value: T, source: string): Sourced<T> => ({ value, confidence: 'unknown', source, estimate: true });

/* ------------------------------------------------------------------ */
/* Rarity ladder by total rating (Real docs, "Player Cards", Oct 2026)  */
/* ------------------------------------------------------------------ */

export interface LadderRung {
  /** 'General', 'Common', 'Legendary 3', 'Mystic 6', 'Iconic 12' … (Iconic 1 is also reachable as plain 'Iconic'). */
  key: string;
  tier: 'General' | 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mystic' | 'Iconic';
  level: number | null;
  /** Cumulative play-card rating the player card needs to be at this rung. */
  totalRating: number;
  /** Earnings multiplier on General-level rax, per Real's doc. (Whether OTD uses the same multiplier: see docs/OTD-MARKET.md.) */
  multiplier: number;
}

const rungs = (
  tier: LadderRung['tier'],
  totals: number[],
  mults: number[],
): LadderRung[] =>
  totals.map((totalRating, i) => ({
    key: `${tier} ${i + 1}`,
    tier,
    level: i + 1,
    totalRating,
    multiplier: mults[i],
  }));

/** Source: https://docs.realapp.link/collect/player-cards (documented; "levels are subject to change"). */
export const RATING_LADDER: LadderRung[] = [
  { key: 'General', tier: 'General', level: null, totalRating: 0, multiplier: 1 },
  { key: 'Common', tier: 'Common', level: null, totalRating: 10, multiplier: 2 },
  { key: 'Uncommon', tier: 'Uncommon', level: null, totalRating: 30, multiplier: 3 },
  { key: 'Rare', tier: 'Rare', level: null, totalRating: 80, multiplier: 4 },
  { key: 'Epic', tier: 'Epic', level: null, totalRating: 180, multiplier: 10 },
  ...rungs('Legendary', [380, 520, 720, 1000, 1180], [25, 28, 32, 35, 40]),
  ...rungs('Mystic', [1380, 1560, 1760, 1980, 2220, 2480, 2760, 3000, 3180, 3250], [75, 79, 83, 87, 91, 95, 98, 101, 103, 105]),
  ...rungs(
    'Iconic',
    [3380, 3800, 4300, 4900, 5600, 6400, 7300, 8300, 9400, 10600, 12000, 13600, 15400, 17500, 19900, 22700, 26000, 29000, 34500, 40000],
    [150, 153, 156, 159, 163, 167, 171, 175, 180, 185, 190, 196, 202, 208, 214, 220, 226, 233, 240, 250],
  ),
];

const RUNG_BY_KEY = new Map(RATING_LADDER.map((r) => [r.key.toLowerCase(), r]));

/**
 * Resolve a rarity key. Accepts the ladder keys above plus the single-level aliases used by shared/otdRules.ts:
 * plain 'Legendary' / 'Mystic' / 'Iconic' mean level 1. Returns null for anything unrecognised.
 */
export function rungFor(key: string): LadderRung | null {
  const k = String(key ?? '').trim().toLowerCase();
  return RUNG_BY_KEY.get(k) ?? RUNG_BY_KEY.get(`${k} 1`) ?? null;
}

/** Rating the card must accumulate to go from one rung to another (null if either key is unknown or `to` <= `from`). */
export function ratingBetween(fromKey: string, toKey: string): number | null {
  const a = rungFor(fromKey);
  const b = rungFor(toKey);
  if (!a || !b) return null;
  return Math.max(0, b.totalRating - a.totalRating);
}

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

/** A user-entered price anchor for a rarity (by full key like 'Iconic' / 'Legendary 3', or by tier like 'Epic'). */
export interface PriceAnchor {
  median: number | null;
  low: number | null;
  high: number | null;
  confidence: PriceConfidence;
  source: string;
}

export interface PriceParams {
  /** Marketplace fee taken from the seller on a sale. */
  marketFee: Sourced<number>;
  /** Rax to claim a Player card at General level (the starting point of every card). */
  playerCardClaimCost: Sourced<number>;
  pack: {
    /** Typical price of one Player pack (3 plays of one player). */
    playerPackPrice: Sourced<number>;
    /** What the pack costs in the pack-swap math ("200 in the hole"). Normally Pro-only. */
    swapPackPrice: Sourced<number>;
    cardsPerPack: Sourced<number>;
    /**
     * Average rating of one play card pulled from a Player pack. Unknown publicly; the swap example implies ~17
     * (410 lowest-offer / 8 min rate / 3 cards) but that is a deduction. Leave null to get "unknown" EV.
     */
    avgPlayRating: Sourced<number | null>;
    /** Rax value you assign to the booster card in each pack (0 = ignore). */
    boosterValue: Sourced<number>;
  };
  /** Price of one rating point of play cards (Rax per rating) — Rateboard's "rate". */
  ratePerRating: { mid: Sourced<number>; low: Sourced<number>; high: Sourced<number> };
  /** Per-sport multiplier on the rate (1 = none). Rateboard covers NFL/CFB/FC/UFC/NHL only; NBA/MLB have no data. */
  sportRateMult: Record<string, number>;
  /**
   * Popular players cost more per rating. rate x (owners / refOwners)^elasticity. elasticity 0 = off (the default, since
   * no source quantifies it). Only applied when the card's `owners` is known.
   */
  ownersAdj: { refOwners: number; elasticity: number; confidence: PriceConfidence; source: string };
  /** Multiplier on rate x rating for the buyer paying above the standing bid. 1 = pay the bid. */
  buyPremium: Sourced<number>;
  /**
   * Optional price anchors per rarity (key or tier). All null by default — no public source quotes marketplace medians.
   * When a median is set it replaces the ladder-based estimate for that rarity.
   */
  rarityAnchors: Record<string, PriceAnchor>;
  /**
   * "Payback" anchors: Rax price per 1 Rax/year of OTD earnings (= years to pay back). Used when `method` is 'payback' or
   * 'blend'. null = no folk-wisdom number was found; set one to use it.
   */
  pricePerAnnualRax: { median: number | null; low: number | null; high: number | null; confidence: PriceConfidence; source: string };
  /** 'ladder' = claim + rating x rate; 'payback' = annual x multiplier x payback years; 'blend' = geometric mean of both. */
  method: 'ladder' | 'payback' | 'blend';
  /** Known prices for specific cards, keyed `${sport}|${season}|${playerId}`. A number applies to every rarity; an object is keyed by rarity key. */
  overrides: Record<string, number | Record<string, number>>;
}

export const DEFAULT_PRICE_PARAMS: PriceParams = {
  // 10% on sales. [community] Rax Academy swap post: "410 - 41 = 369". Not stated in any Real doc (Terms/FAQ/changelog silent).
  marketFee: comm(0.1, 'Rax Academy pack-swap post (410-41=369); no Real doc states it'),

  // [documented] docs.realapp.link/collect/player-cards: "Cost: 200 Rax"; MLB launch post "All player cards are 200 Rax".
  // Free card per sport each season (docs) is ignored here.
  playerCardClaimCost: doc(200, 'Real docs, Player Cards: Cost 200 Rax'),

  pack: {
    // [community] 271 "normally" (Rax Academy); [documented] Real docs say "200+" and changelog says 200-400 rising with the
    // player's season rank (Dec 2025: up to 5 player packs/day at increasing prices). 271 is one point in that range.
    playerPackPrice: comm(271, 'Rax Academy "160 back" post: 271 normally. Real docs: 200+ (200-400, rises with player rank)'),
    // [community] The swap post's "200 in the hole" figure. Normally Pro-only per the post; the doc range starts at 200.
    swapPackPrice: comm(200, 'Rax Academy pack-swap post: both players "200 in the hole"'),
    // [documented] docs.realapp.link/collect/card-packs: Player Pack = 3 plays from one player (+1 booster).
    cardsPerPack: doc(3, 'Real docs, Card Packs: Player Pack = 3 plays (+ booster)'),
    // [unknown] No odds/pull rates are published anywhere found. Rating of a pulled play card varies with game situation.
    avgPlayRating: unk(null, 'no published pull rates or rating distribution; swap example implies ~17 per card (inferred)'),
    boosterValue: unk(0, 'booster cards are single-use; no market price found — set your own'),
  },

  // Rateboard board fetched 2026-10-10: 637 live offers, median 10, 29% sit on the 8 floor, p75 15-20, p90 25-30 (NFL/CFB/FC/NHL;
  // UFC and a few FC stars reach 50-100). These are BUYER bids on play cards, not observed sale prices => [inferred].
  ratePerRating: {
    mid: infer(10, 'Rateboard 2026-10-10: median of 637 standing offers = 10 Rax/rating; min tier 8'),
    low: infer(8, 'Rateboard minimum tier (MIN_TIER=8); house list pays 8 for 27/30 NFL players'),
    high: infer(30, 'Rateboard 2026-10-10: p90 of offers 25-30 for NFL/CFB/FC; stars higher'),
  },
  sportRateMult: {},
  ownersAdj: { refOwners: 20_000, elasticity: 0, confidence: 'unknown', source: 'no source quantifies owners -> price; off by default' },
  buyPremium: unk(1, 'buyers must at least match standing bids; real premium not measured'),

  rarityAnchors: {}, // intentionally empty: no published per-rarity marketplace medians (see docs/OTD-MARKET.md section 4)
  pricePerAnnualRax: { median: null, low: null, high: null, confidence: 'unknown', source: 'no "payback days" quote found in public sources' },
  method: 'ladder',
  overrides: {},
};

/* ------------------------------------------------------------------ */
/* Card price estimate                                                 */
/* ------------------------------------------------------------------ */

export interface PriceCardInput {
  id: string;
  sport: string;
  season: number;
  name: string;
  /** General-level annual rax (Σ over the season's games). */
  annual: number;
  owners: number | null;
}

export interface PriceEstimate {
  price: number;
  low: number;
  high: number;
  /** One line for the UI. */
  basis: string;
  confidence: PriceConfidence;
  /** Which model produced the number. */
  method: 'override' | 'anchor' | 'ladder' | 'payback' | 'blend' | 'claim' | 'unknown';
  /** Rating the card needs beyond General (ladder method), when known. */
  ratingNeeded?: number;
  /** Rate (Rax per rating point) actually used, when the ladder method ran. */
  rateUsed?: number;
}

const round = (n: number) => Math.round(n);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Rate band for one card after sport and owners adjustments. */
export function rateBand(card: Pick<PriceCardInput, 'sport' | 'owners'>, p: PriceParams): { mid: number; low: number; high: number } {
  const sportMult = p.sportRateMult[card.sport] ?? 1;
  const ownersMult =
    card.owners != null && card.owners > 0 && p.ownersAdj.elasticity !== 0
      ? Math.pow(card.owners / p.ownersAdj.refOwners, p.ownersAdj.elasticity)
      : 1;
  const m = sportMult * ownersMult * p.buyPremium.value;
  return { mid: p.ratePerRating.mid.value * m, low: p.ratePerRating.low.value * m, high: p.ratePerRating.high.value * m };
}

function anchorFor(p: PriceParams, rung: LadderRung): PriceAnchor | null {
  const a = p.rarityAnchors[rung.key] ?? p.rarityAnchors[rung.tier];
  return a && a.median != null && a.median > 0 ? a : null;
}

/**
 * Estimate what it costs to hold `card` at `targetRarity` (a RarityLevel.key, e.g. 'Iconic', 'Legendary 3').
 * Order of precedence: per-card override -> user rarity anchor -> `params.method` model.
 */
export function estimateCardPrice(card: PriceCardInput, targetRarity: string, params: PriceParams): PriceEstimate {
  const rung = rungFor(targetRarity);
  if (!rung) {
    return { price: 0, low: 0, high: 0, basis: `Unknown rarity "${targetRarity}" — cannot price`, confidence: 'unknown', method: 'unknown' };
  }

  // 1. Per-card override (a price the user actually saw in-app).
  const ov = params.overrides[card.id];
  const ovPrice = typeof ov === 'number' ? ov : ov ? ov[rung.key] ?? ov[targetRarity] : undefined;
  if (ovPrice != null && ovPrice >= 0) {
    return { price: ovPrice, low: ovPrice, high: ovPrice, basis: `Your entered price for ${card.name} ${rung.key}`, confidence: 'documented', method: 'override' };
  }

  // 2. General: just the claim cost.
  const claim = params.playerCardClaimCost.value;
  if (rung.totalRating === 0) {
    return { price: claim, low: claim, high: claim, basis: `Claim cost of a General player card (${fmt(claim)} Rax)`, confidence: params.playerCardClaimCost.confidence, method: 'claim' };
  }

  // 3. User-entered rarity anchor.
  const anc = anchorFor(params, rung);
  if (anc) {
    const price = anc.median as number;
    return {
      price,
      low: anc.low ?? price * 0.7,
      high: anc.high ?? price * 1.5,
      basis: `${rung.key} anchor: ${fmt(price)} Rax (${anc.source})`,
      confidence: anc.confidence,
      method: 'anchor',
    };
  }

  // 4. Model.
  const rate = rateBand(card, params);
  const ratingNeeded = rung.totalRating;
  const ladder = {
    price: claim + ratingNeeded * rate.mid,
    low: claim + ratingNeeded * rate.low,
    high: claim + ratingNeeded * rate.high,
  };
  const ladderBasis = `${fmt(claim)} claim + ${fmt(ratingNeeded)} rating x ${rate.mid.toFixed(1)} Rax/rating (band ${rate.low.toFixed(0)}-${rate.high.toFixed(0)})`;

  const pb = params.pricePerAnnualRax;
  const annualRung = card.annual * rung.multiplier;
  const havePayback = pb.median != null && pb.median > 0 && card.annual > 0;
  const payback = havePayback
    ? {
        price: annualRung * (pb.median as number),
        low: annualRung * (pb.low ?? (pb.median as number) * 0.5),
        high: annualRung * (pb.high ?? (pb.median as number) * 2),
      }
    : null;
  const paybackBasis = payback ? `${fmt(annualRung)} Rax/yr x ${pb.median} years payback` : '';

  if (params.method === 'payback' && payback) {
    return { ...payback, basis: paybackBasis, confidence: pb.confidence, method: 'payback' };
  }
  if (params.method === 'blend' && payback) {
    const g = (a: number, b: number) => Math.sqrt(a * b);
    return {
      price: round(g(ladder.price, payback.price)),
      low: round(g(ladder.low, payback.low)),
      high: round(g(ladder.high, payback.high)),
      basis: `Blend of [${ladderBasis}] and [${paybackBasis}]`,
      confidence: 'inferred',
      method: 'blend',
      ratingNeeded,
      rateUsed: rate.mid,
    };
  }
  const note = params.method !== 'ladder' && !payback ? ' (payback anchor not set — using ladder)' : '';
  return {
    price: round(ladder.price),
    low: round(ladder.low),
    high: round(ladder.high),
    basis: ladderBasis + note,
    // The ladder is documented; the rate is a Rateboard-bid-based estimate. The product is only as good as the rate.
    confidence: params.ratePerRating.mid.confidence === 'unknown' ? 'unknown' : 'inferred',
    method: 'ladder',
    ratingNeeded,
    rateUsed: rate.mid,
  };
}

/** Price to level an already-owned card from one rung to another (ladder method only; anchors/overrides are whole-card prices). */
export function estimateUpgradeCost(
  card: PriceCardInput,
  fromRarity: string,
  toRarity: string,
  params: PriceParams,
): PriceEstimate {
  const need = ratingBetween(fromRarity, toRarity);
  if (need == null) return { price: 0, low: 0, high: 0, basis: 'Unknown rarity key', confidence: 'unknown', method: 'unknown' };
  const rate = rateBand(card, params);
  return {
    price: round(need * rate.mid),
    low: round(need * rate.low),
    high: round(need * rate.high),
    basis: `${fmt(need)} more rating (${fromRarity} -> ${toRarity}) x ${rate.mid.toFixed(1)} Rax/rating`,
    confidence: 'inferred',
    method: 'ladder',
    ratingNeeded: need,
    rateUsed: rate.mid,
  };
}

/** Implied ladder price for every rung of a card, for a reference table in the UI. */
export function ladderPriceTable(card: PriceCardInput, params: PriceParams): Array<{ key: string; multiplier: number; totalRating: number } & PriceEstimate> {
  return RATING_LADDER.map((r) => ({ key: r.key, multiplier: r.multiplier, totalRating: r.totalRating, ...estimateCardPrice(card, r.key, params) }));
}

/* ------------------------------------------------------------------ */
/* Swaps                                                               */
/* ------------------------------------------------------------------ */

export interface SwapRow {
  label: string;
  /** Signed: negative = you pay, positive = you receive. */
  amount: number;
  /** Running balance after this step (negative = you are "in the hole"). */
  balance: number;
  note?: string;
}

export interface SwapResult {
  rows: SwapRow[];
  /** Rax you are out of pocket at the end (positive = cost, negative = you gain Rax). */
  netCost: number;
  /** Net cost after crediting the booster value. */
  netCostAfterBooster: number;
  /** Savings vs. buying the same pack outright at `comparePackPrice` (positive = swap is cheaper). */
  savingsVsDirect: number | null;
  /** One-line summary for the UI. */
  summary: string;
}

export interface PackSwapInputs {
  kind: 'pack-swap';
  /** Price of your pack ("200 in the hole"). */
  packPrice: number;
  /** Offer you send on the partner's pack (lowest possible, ~410-420). */
  offerSent: number;
  /** Offer the partner sends on your pack. Symmetric swaps: same as offerSent. */
  offerReceived: number;
  /** Marketplace fee on the sale of your pack's cards (0.10). */
  fee: number;
  boosterValue?: number;
  /** The price you'd pay for the same pack without a swap (e.g. 271). */
  comparePackPrice?: number;
}

export interface CashBackInputs {
  kind: 'cash-back';
  /** Price of the pack you buy for the player they are grinding (271 normally). */
  packPrice: number;
  /**
   * Flat Rax the grinder sends back to you ("160 back"), net of any fee. This is the figure from the post; how it
   * decomposes into offer minus fee is not stated.
   */
  cashBack: number;
  /** Optional: gross offer on your pulled cards (in addition to the cash back). Fee is deducted. */
  offerReceived?: number;
  fee: number;
  boosterValue?: number;
  comparePackPrice?: number;
}

export type SwapInputs = PackSwapInputs | CashBackInputs;

/**
 * Pack swap: net = pack + offerSent - offerReceived x (1 - fee). Symmetric case (offers equal O): net = pack + fee x O,
 * i.e. 200 + 0.10 x 410 = 241.  Cash-back: net = pack - cashBack - offerReceived x (1 - fee); 271 - 160 = 111.
 */
export function swapCost(inputs: SwapInputs): SwapResult {
  const rows: SwapRow[] = [];
  let bal = 0;
  const push = (label: string, amount: number, note?: string) => {
    bal += amount;
    rows.push({ label, amount, balance: bal, note });
  };

  if (inputs.kind === 'pack-swap') {
    push('Buy a pack for your player', -inputs.packPrice, `"${fmt(inputs.packPrice)} in the hole"`);
    push("Send your offer on your partner's pack", -inputs.offerSent, `you are now down ${fmt(inputs.packPrice + inputs.offerSent)} Rax`);
    push('Partner\'s offer on your pack is accepted', inputs.offerReceived);
    push(`Marketplace fee (${(inputs.fee * 100).toFixed(0)}% of that sale)`, -inputs.offerReceived * inputs.fee, `${fmt(inputs.offerReceived)} - ${fmt(inputs.offerReceived * inputs.fee)} = ${fmt(inputs.offerReceived * (1 - inputs.fee))}`);
  } else {
    push('Buy a pack for the player they are grinding', -inputs.packPrice);
    push('Grinder sends Rax back', inputs.cashBack, `"${fmt(inputs.cashBack)} back"`);
    if (inputs.offerReceived) {
      push('Their offer on your pulled cards', inputs.offerReceived);
      push(`Marketplace fee (${(inputs.fee * 100).toFixed(0)}%)`, -inputs.offerReceived * inputs.fee);
    }
  }

  const netCost = -bal;
  const booster = inputs.boosterValue ?? 0;
  if (booster) push('Booster card value (your estimate)', booster);
  const netCostAfterBooster = -bal;
  const savingsVsDirect = inputs.comparePackPrice != null ? inputs.comparePackPrice - netCost : null;
  const summary =
    `Net ${netCost >= 0 ? 'cost' : 'gain'} ${fmt(Math.abs(netCost))} Rax per pack` +
    (booster ? ` (${fmt(Math.abs(netCostAfterBooster))} after booster value)` : '') +
    (savingsVsDirect != null ? `; ${savingsVsDirect >= 0 ? 'saves' : 'costs'} ${fmt(Math.abs(savingsVsDirect))} vs buying outright` : '');
  return { rows, netCost, netCostAfterBooster, savingsVsDirect, summary };
}

/** Closed form for a symmetric pack swap: pack + fee x offer. */
export const symmetricSwapCost = (packPrice: number, offer: number, fee: number): number => packPrice + fee * offer;

/** Gross offer needed to net `net` Rax after the marketplace fee. */
export const grossForNet = (net: number, fee: number): number => (fee < 1 ? net / (1 - fee) : Infinity);

/* ------------------------------------------------------------------ */
/* Pack economics                                                      */
/* ------------------------------------------------------------------ */

export interface PackEconomics {
  /** Gross market value of the pack's play cards at the assumed rate (before fee), or null if pull data is unknown. */
  grossValue: number | null;
  /** After the marketplace fee (what you'd net by selling every card). */
  netValue: number | null;
  /** Pack price minus netValue minus booster value; null if netValue is null. */
  netCost: number | null;
  packPrice: number;
  cardsPerPack: number;
  confidence: PriceConfidence;
  explanation: string;
}

/**
 * Expected value of one Player pack. Needs the average rating of a pulled play card, which no public source gives, so by
 * default this returns nulls with an explanation. Set `params.pack.avgPlayRating` (e.g. from your own pulls) to enable it.
 */
export function packEconomics(params: PriceParams): PackEconomics {
  const price = params.pack.playerPackPrice.value;
  const n = params.pack.cardsPerPack.value;
  const avg = params.pack.avgPlayRating.value;
  if (avg == null || !(avg > 0)) {
    return {
      grossValue: null,
      netValue: null,
      netCost: null,
      packPrice: price,
      cardsPerPack: n,
      confidence: 'unknown',
      explanation:
        'Pull rates and play-card rating distribution are not published. Enter the average rating of your own pulled cards ' +
        '(the swap example implies roughly 17 per card at the 8 Rax/rating floor) to see expected value.',
    };
  }
  const gross = n * avg * params.ratePerRating.mid.value;
  const net = gross * (1 - params.marketFee.value);
  return {
    grossValue: gross,
    netValue: net,
    netCost: price - net - params.pack.boosterValue.value,
    packPrice: price,
    cardsPerPack: n,
    confidence: 'inferred',
    explanation: `${n} cards x ${avg} rating x ${params.ratePerRating.mid.value} Rax/rating = ${fmt(gross)} gross, ${fmt(net)} after the ${(params.marketFee.value * 100).toFixed(0)}% fee, versus a ${fmt(price)} pack.`,
  };
}

/** Rax a seller keeps from a sale after the marketplace fee. */
export const afterFee = (gross: number, params: PriceParams): number => gross * (1 - params.marketFee.value);

/** Deep-ish copy of params so UI state can be edited without touching the defaults. */
export const cloneParams = (p: PriceParams = DEFAULT_PRICE_PARAMS): PriceParams =>
  JSON.parse(JSON.stringify(p)) as PriceParams;
