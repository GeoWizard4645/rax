/**
 * Real's OTD (On This Day) rules as constants. Every value carries a confidence + source; anything not established is
 * `null` + 'unknown' (never invented). The prose version (with reasoning and open questions) is docs/OTD-MECHANICS.md.
 *
 * Confidence: 'documented' = Real's own docs / changelog / official X posts (docs.realapp.link, @realapp, @realapp_);
 * 'community' = stated by an experienced player / guide author (Rax Academy by Dennis) but not by Real;
 * 'inferred' = deduced by us from documented or community data (reasoning in docs/OTD-MECHANICS.md);
 * 'unknown' = not established (value is null, or a clearly-labelled working assumption).
 *
 * Snapshot date: 2026-10-10. Real changes these numbers often (multipliers changed Aug 2025 and Dec 2025, the sport
 * factors in mid-2026) — treat as a snapshot and re-verify against the docs pages below.
 */
export type Confidence = 'documented' | 'community' | 'inferred' | 'unknown';

export interface Fact<T> {
  value: T;
  confidence: Confidence;
  source: string;
}

/** One rung of the rarity ladder. Cards pay `multiplier × (General-level rax)` per claim, up to `annualCap` per year. */
export interface RarityLevel {
  /** e.g. 'Legendary 3'. */
  key: string;
  tier: 'General' | 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mystic' | 'Iconic';
  /** Sub-level within the tier (Legendary 1–5, Mystic 1–10, Iconic 1–20); null for single-level tiers. */
  level: number | null;
  /** Payout multiplier over General-level rax (same multiplier as the live per-game earnings multiplier). */
  multiplier: Fact<number | null>;
  /**
   * Max Rax this one card can earn from OTD (the "total Rax" cap). null value = uncapped (Iconic) — see `capPeriod`
   * for whether it is per year or lifetime (NOT firmly established).
   */
  annualCap: Fact<number | null>;
  /**
   * Rax cost to upgrade a card from the previous rung to this one. ALWAYS null/unknown: Real has no "upgrade" purchase —
   * a card's level is a function of the summed rating of Play/Performance cards you own for that player-season
   * (`cumulativeRating`). The Rax cost is whatever you pay (packs / marketplace) to acquire those rating points.
   */
  upgradeCost: Fact<number | null>;
  /** Cumulative summed play+performance rating needed to hold this rung (documented). null = General (0). */
  cumulativeRating: Fact<number | null>;
  /** Can a card at this rung make OTD claims? ('Common or better'.) */
  otdEligible: boolean;
}

export interface OtdClaimRules {
  /** Guaranteed claims per sport per day for non-Pro users. */
  freePerSportPerDay: Fact<number>;
  /**
   * GUARANTEED claims per sport per day for Pro users. Pro does NOT get a 3rd guaranteed claim per sport — see the
   * `proBonus*` fields: one extra claim per day across ALL sports, gated on winning a pick-the-winner poll.
   */
  proPerSportPerDay: Fact<number>;
  /** Is the claim limit per sport or shared across all sports? */
  scope: Fact<'per-sport' | 'global'>;
  /** Extra claims a Pro member gets per day (across all sports combined). */
  proBonusClaimsPerDay: Fact<number>;
  /** Pro bonus claim is only granted if you win the poll you place the card on ("chance at", not guaranteed). */
  proBonusConditionalOnPollWin: Fact<boolean>;
  /** Probability the Pro bonus poll is won (depends on the poll chosen). null = unknown. Model it as a parameter. */
  proBonusWinProbability: Fact<number | null>;
  /** How long after the anniversary a claim stays available (days). null = unknown (working assumption: 0 = same day). */
  claimWindowDays: Fact<number | null>;
  /** Does an unused daily claim carry over / can missed days be claimed later? null = unknown (assume NO). */
  unusedClaimsCarryOver: Fact<boolean | null>;
  /** Whether the per-card cap resets each year ('per-year', working assumption) or is a lifetime total. */
  capPeriod: Fact<'per-year' | 'lifetime'>;
}

/** Per-sport rules that change the payout (buffs, playoff multipliers, special notes). */
export interface SportRule {
  sport: string;
  /** Multiplier applied to regular-season games vs. the PREVIOUS base rating→rax factor. 1 = none. (CFB defense: see notes.) */
  regSeasonBuff: Fact<number>;
  /** Multiplier for postseason games vs. the previous base. */
  playoffBuff: Fact<number>;
  notes: string;
}

export const ICONIC_MULTIPLIER = 150;

const DOCS = 'https://docs.realapp.link';
const SRC_OTD = `${DOCS}/collect/on-this-day`;
const SRC_PC = `${DOCS}/collect/player-cards`;
const SRC_CL = `${DOCS}/updates/changelog`;
const SRC_ACAD = 'Rax Academy (Dennis) albums, 2026';

const documented = <T,>(value: T, source: string): Fact<T> => ({ value, confidence: 'documented', source });
const community = <T,>(value: T, source: string): Fact<T> => ({ value, confidence: 'community', source });
const inferred = <T,>(value: T, source: string): Fact<T> => ({ value, confidence: 'inferred', source });
const unknown = <T,>(value: T, source = 'not established by any public source found (2026-10-10)'): Fact<T> => ({ value, confidence: 'unknown', source });

const SRC_MULT = `${SRC_PC} (multiplier table, current Oct 2026; Epic+ raised Dec 2025: ${SRC_CL})`;
const SRC_CAP = `${SRC_OTD} + ${SRC_PC} (per-level "OTD Cap" lines)`;
const NO_UPGRADE_COST = unknown<number | null>(null, 'Real has no Rax upgrade fee: level = summed rating of owned play/performance cards (see cumulativeRating); Rax cost depends on pack/marketplace prices');
const SRC_RATING = `${SRC_PC} (cumulative rating thresholds; the page's "Additional 1000/2000" headers for Mystic 1 / Iconic 1 are stale typos — the totals chain and the Mar-2026 archive say +200 / +130)`;

interface Rung {
  key: string;
  tier: RarityLevel['tier'];
  level: number | null;
  mult: number;
  cap: number | null;
  rating: number | null;
  eligible?: boolean;
}

const RUNGS: Rung[] = [
  { key: 'General', tier: 'General', level: null, mult: 1, cap: 0, rating: null, eligible: false },
  { key: 'Common', tier: 'Common', level: null, mult: 2, cap: 1_000, rating: 10 },
  { key: 'Uncommon', tier: 'Uncommon', level: null, mult: 3, cap: 1_500, rating: 30 },
  { key: 'Rare', tier: 'Rare', level: null, mult: 4, cap: 2_000, rating: 80 },
  { key: 'Epic', tier: 'Epic', level: null, mult: 10, cap: 5_000, rating: 180 },
  { key: 'Legendary 1', tier: 'Legendary', level: 1, mult: 25, cap: 12_500, rating: 380 },
  { key: 'Legendary 2', tier: 'Legendary', level: 2, mult: 28, cap: 14_000, rating: 520 },
  { key: 'Legendary 3', tier: 'Legendary', level: 3, mult: 32, cap: 16_000, rating: 720 },
  { key: 'Legendary 4', tier: 'Legendary', level: 4, mult: 35, cap: 17_500, rating: 1_000 },
  { key: 'Legendary 5', tier: 'Legendary', level: 5, mult: 40, cap: 20_000, rating: 1_180 },
  { key: 'Mystic 1', tier: 'Mystic', level: 1, mult: 75, cap: 37_500, rating: 1_380 },
  { key: 'Mystic 2', tier: 'Mystic', level: 2, mult: 79, cap: 39_500, rating: 1_560 },
  { key: 'Mystic 3', tier: 'Mystic', level: 3, mult: 83, cap: 41_500, rating: 1_760 },
  { key: 'Mystic 4', tier: 'Mystic', level: 4, mult: 87, cap: 43_500, rating: 1_980 },
  { key: 'Mystic 5', tier: 'Mystic', level: 5, mult: 91, cap: 45_500, rating: 2_220 },
  { key: 'Mystic 6', tier: 'Mystic', level: 6, mult: 95, cap: 47_500, rating: 2_480 },
  { key: 'Mystic 7', tier: 'Mystic', level: 7, mult: 98, cap: 49_000, rating: 2_760 },
  // Official cap is 50,000 (not 101×500 = 50,500) — the one place the "cap = 500 × multiplier" pattern breaks.
  { key: 'Mystic 8', tier: 'Mystic', level: 8, mult: 101, cap: 50_000, rating: 3_000 },
  { key: 'Mystic 9', tier: 'Mystic', level: 9, mult: 103, cap: 51_500, rating: 3_180 },
  { key: 'Mystic 10', tier: 'Mystic', level: 10, mult: 105, cap: 52_500, rating: 3_250 },
  { key: 'Iconic', tier: 'Iconic', level: null, mult: ICONIC_MULTIPLIER, cap: null, rating: 3_380 },
];

/** General → Mystic 10 → Iconic (level 1, keyed 'Iconic'). Iconic 2–20 are in ICONIC_LEVELS. */
export const RARITY_LADDER: RarityLevel[] = RUNGS.map((r): RarityLevel => ({
  key: r.key,
  tier: r.tier,
  level: r.level,
  multiplier: r.key === 'Iconic'
    ? documented(r.mult, `${SRC_MULT}; Rax Academy lists confirm (Iconic earnings = General × 150)`)
    : documented(r.mult, SRC_MULT),
  annualCap:
    r.key === 'General'
      ? documented(0, `${SRC_OTD}: General listed at 200 total, but OTD requires "Common or better" so a General card cannot claim (value 0 = no OTD payout)`)
      : r.cap === null
        ? documented(null, `${SRC_OTD}: Iconic "Unlimited*" (subject to change)`)
        : documented(r.cap, SRC_CAP),
  upgradeCost: NO_UPGRADE_COST,
  cumulativeRating: r.rating === null ? documented(0, SRC_RATING) : documented(r.rating, SRC_RATING),
  otdEligible: r.eligible !== false,
}));

/** Iconic 2–20: multiplier (documented) and cumulative rating needed. Uncapped (cap = "Unlimited*"). Iconic 1 is 'Iconic' in RARITY_LADDER. */
export const ICONIC_LEVELS: ReadonlyArray<{ key: string; level: number; multiplier: number; cumulativeRating: number }> = [
  [2, 153, 3_800], [3, 156, 4_300], [4, 159, 4_900], [5, 163, 5_600], [6, 167, 6_400], [7, 171, 7_300], [8, 175, 8_300],
  [9, 180, 9_400], [10, 185, 10_600], [11, 190, 12_000], [12, 196, 13_600], [13, 202, 15_400], [14, 208, 17_500],
  [15, 214, 19_900], [16, 220, 22_700], [17, 226, 26_000], [18, 233, 29_000], [19, 240, 34_500], [20, 250, 40_000],
].map(([level, multiplier, cumulativeRating]) => ({ key: `Iconic ${level}`, level, multiplier, cumulativeRating }));

export const ICONIC_LEVELS_SOURCE = `${SRC_PC} (documented, Oct 2026; "subject to change with additional levels")`;

export const CLAIM_RULES: OtdClaimRules = {
  freePerSportPerDay: documented(2, `${SRC_OTD}: "2 guaranteed claims per sport per day"`),
  proPerSportPerDay: documented(2, `${SRC_OTD}: Pro has the same 2 guaranteed per sport; the 3rd is the conditional Pro bonus (below)`),
  scope: documented('per-sport', `${SRC_OTD}: "per sport per day"; changelog 2024-03-15 ("2 players or 2 teams a day")`),
  proBonusClaimsPerDay: documented(1, `${SRC_OTD}: "1 additional claim across all sports each day" (Pro bonus, added ${SRC_CL} 2024-08-15)`),
  proBonusConditionalOnPollWin: documented(true, `${SRC_OTD}: place the pass on a pick-the-winner poll; win it = bonus Rax, lose = none`),
  proBonusWinProbability: unknown(null, 'depends on the poll picked; no public data. Model as a user parameter (50% is a placeholder, not a fact)'),
  claimWindowDays: unknown(0, 'working assumption: claim is for the anniversary date itself; docs say nothing about grace periods'),
  unusedClaimsCarryOver: unknown(null, 'docs call the 2 claims "daily"; nothing says unused ones carry over. Assume no.'),
  capPeriod: unknown('per-year', `docs say only "total Rax a card can earn"; community frames OTD as an annual flow (${SRC_ACAD}). Working assumption: resets yearly — verify in-app (docs/OTD-MECHANICS.md Q1)`),
};

/** Base rating → rax factor per sport, CURRENT (Oct 2026 docs), and the pre-buff values where known. Playoffs/majors are 2×. */
export interface SportFactor {
  sport: string;
  /** Current factor(s) applied to a player's Real rating (documented). */
  current: Record<string, number>;
  /** Factor(s) before the mid-2026 changes (documented via archived docs, 2026-06-17), if different. */
  previous?: Record<string, number>;
}

export const SPORT_RATING_FACTORS: SportFactor[] = [
  { sport: 'NFL', current: { offense: 5, defense: 7 } },
  { sport: 'CFB', current: { offense: 5, defense: 8 }, previous: { offense: 4, defense: 7 } },
  { sport: 'NBA', current: { all: 1 } },
  { sport: 'WNBA', current: { all: 2 }, previous: { all: 2 } },
  { sport: 'CBB', current: { all: 2.5 }, previous: { all: 2 } },
  { sport: 'NHL', current: { all: 1.2 } },
  { sport: 'MLB', current: { batter: 2, startingPitcher: 3, reliefPitcher: 5 } },
  { sport: 'Golf', current: { all: 3 } },
  { sport: 'FC', current: { all: 3.5 } },
];
export const SPORT_FACTORS_SOURCE = `${SRC_PC} "Earn Rax" (current) + web.archive.org snapshot of the same page 2026-06-17 (previous)`;
/** Playoffs and major tournaments pay 2× the regular-season base. */
export const PLAYOFF_MULTIPLIER = documented(2, `${SRC_PC}: "Playoffs and major tournaments are 2x more than the regular season base earnings"`);

export const SPORT_RULES: SportRule[] = [
  {
    sport: 'CBB',
    regSeasonBuff: community(1.25, `${SRC_ACAD}: July-2026 buff reg ×2→×2.5; docs confirm 2 (archive 2026-06-17) → 2.5 (now)`),
    playoffBuff: community(1.25, `${SRC_ACAD}: playoffs ×4→×5 (= 2× the new base)`),
    notes: 'Buff already applied to figures in the community lists (Edey 565 → 708 General). Applies retroactively to OTD (historical seasons re-priced).',
  },
  {
    sport: 'CFB',
    regSeasonBuff: community(1.25, `${SRC_ACAD}: July-2026 buff offense ×4→×5, defense ×7→×8; docs confirm`),
    playoffBuff: community(1.25, `${SRC_ACAD}: playoffs offense ×8→×10, defense ×14→×16`),
    notes: 'regSeasonBuff/playoffBuff are the OFFENSE ratio (1.25). Defense is 8/7 ≈ 1.143. Already applied to community lists (Jeanty 537 → 669).',
  },
  { sport: 'MLB', regSeasonBuff: documented(1.33, `${SRC_PC} archive: batters 1.5→2, SP 2→3, RP 4→5 between 2025-12 and 2026-06 (batters ×1.33, SP ×1.5, RP ×1.25)`), playoffBuff: documented(1.33, 'same'), notes: 'Not mentioned by the community; check whether Rateboard/OTD figures for MLB use the old or new factor (open question Q6).' },
  { sport: 'WNBA', regSeasonBuff: documented(0.67, `${SRC_PC} archive: 3x (2025-12) → 2x (2026-06): a nerf`), playoffBuff: documented(0.67, 'same'), notes: 'Not covered by the community lists.' },
];

/** Total OTD Rax caps for fighters (UFC) and teams, per rung. Player caps live in RARITY_LADDER. Documented (OTD page + player-cards page). */
export const FIGHTER_CAPS: Record<string, number> = {
  General: 800, Common: 1_500, Uncommon: 3_000, Rare: 6_000, Epic: 12_000,
  'Legendary 1': 24_000, 'Legendary 2': 25_500, 'Legendary 3': 27_000, 'Legendary 4': 28_500, 'Legendary 5': 30_000,
  'Mystic 1': 48_000, 'Mystic 2': 50_000, 'Mystic 3': 52_000, 'Mystic 4': 54_000, 'Mystic 5': 56_000,
  'Mystic 6': 58_000, 'Mystic 7': 60_000, 'Mystic 8': 62_000, 'Mystic 9': 64_000, 'Mystic 10': 67_000,
};
export const TEAM_CAPS: Record<string, number> = {
  General: 800, Common: 1_500, Uncommon: 2_500, Rare: 4_000, Epic: 6_000, 'Legendary 1': 12_000, 'Mystic 1': 24_000,
};
/** Team-card multipliers per the team-cards page (page looks stale vs the player ladder — treat with caution). Fighter multipliers: unknown. */
export const TEAM_MULTIPLIERS = documented(
  { Common: 1.2, Uncommon: 1.4, Rare: 1.6, Epic: 2, Legendary: 2.5, Mystic: 4, Iconic: 6 } as Record<string, number>,
  `${DOCS}/collect/team-cards (possibly stale; the player page was updated Dec 2025, this one apparently not)`,
);

/** Booster cards — NOT shown to affect OTD claims. */
export const BOOSTER_RULES = {
  /** Applied to a player card before a game, one day only; unused boosters roll to next season of that sport. */
  liveEarnings: documented('flat extra Rax per listed stat on the game day (e.g. NBA Legendary 3PT booster = 20 Rax per three)', `${SRC_PC} "Boost Your Player Cards"; @realapp 2025-08-18: "Booster cards add, not multiply"`),
  /** Whether boosters change OTD claims. No source says so; OTD pays the historical *base* earnings × rarity multiplier. */
  affectsOtd: inferred<boolean | null>(false, 'no doc or community post says boosters apply to OTD; the OTD example is "player earned 18 Rax × 1.6 rarity" and Rax Academy sums are un-boosted General rax. Treat as NO until verified.'),
};

/** Pack prices (Rax) relevant to what leveling costs. Rating-per-pack is NOT documented. */
export const PACK_PRICES = {
  starter: documented(100, `${DOCS}/collect/card-packs (3 plays)`),
  general: documented(200, `${DOCS}/collect/card-packs (5 plays + 1 performance + booster; Sep 2026: "2 top-30 players and an additional play card")`),
  yesterday: documented(200, `${DOCS}/collect/card-packs`),
  player: documented(200, `${DOCS}/collect/card-packs ("200+", 3 plays of one player; price rises with season rank, changelog 2025-12-20)`),
  team: documented(300, `${DOCS}/collect/card-packs (changelog 2025-03-10 says 200–400)`),
  game: documented(800, `${DOCS}/collect/card-packs ("800+", up to 1,250)`),
  /** Player card claim price. Past-season cards are purchasable since 2023-10-26. */
  playerCard: documented(200, `${SRC_PC}`),
  teamCard: documented(800, `${DOCS}/collect/team-cards`),
};

/** Arena Boost by pass rarity (first reaching the rarity; grows within a rarity). Arena is staked Rax PvP — it does NOT change OTD earnings. */
export const ARENA_BOOST_BY_RARITY: Record<string, number> = {
  Common: 0.01, Uncommon: 0.03, Rare: 0.09, Epic: 0.18, Legendary: 0.32, Mystic: 0.56, Iconic: 0.6,
};
export const ARENA_SOURCE = `${DOCS}/interact/arena ("Rules as of October 9, 2026")`;

export const capFor = (key: string): number | null => RARITY_LADDER.find((r) => r.key === key)?.annualCap.value ?? null;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers (pure). Payout model = min(cap, multiplier × General-level season OTD total). Per-claim rounding is unknown.
// ---------------------------------------------------------------------------------------------------------------------

const ICONIC_BY_KEY = new Map(ICONIC_LEVELS.map((l) => [l.key, l]));

/** Multiplier for any rung key including 'Iconic 2'…'Iconic 20'. null if unknown key. */
export function multiplierFor(key: string): number | null {
  const r = RARITY_LADDER.find((x) => x.key === key);
  if (r) return r.multiplier.value;
  return ICONIC_BY_KEY.get(key)?.multiplier ?? null;
}

/** Cumulative summed play+performance rating needed to hold a rung (0 for General). null if unknown key. */
export function ratingToReach(key: string): number | null {
  const r = RARITY_LADDER.find((x) => x.key === key);
  if (r) return r.cumulativeRating.value;
  return ICONIC_BY_KEY.get(key)?.cumulativeRating ?? null;
}

/** Highest rung a card holds given the summed rating of its play + performance cards (negative plays count by absolute value). */
export function rungForRating(totalRating: number): string {
  let best = 'General';
  for (const r of RARITY_LADDER) if (totalRating >= (r.cumulativeRating.value ?? 0) && r.key !== 'General') best = r.key;
  for (const l of ICONIC_LEVELS) if (totalRating >= l.cumulativeRating) best = l.key;
  return best;
}

/**
 * Annual OTD payout for one card at a rung, given its "Earnings at General" for the season (Σ per-game General rax).
 * = min(cap, multiplier × general); Iconic (and Iconic n) have no cap. General cards pay 0 (not eligible).
 * This treats the cap as applying to the annual sum (capPeriod 'per-year' is a working assumption).
 */
export function annualPayout(generalEarnings: number, key: string): number {
  const rung = RARITY_LADDER.find((r) => r.key === key);
  if (rung && !rung.otdEligible) return 0;
  const mult = multiplierFor(key);
  if (mult === null) return 0;
  const raw = mult * generalEarnings;
  const cap = rung ? rung.annualCap.value : null; // Iconic n → uncapped
  return cap === null ? raw : Math.min(raw, cap);
}

/**
 * Rax paid for one claim (one card-day). `baseRax` = that day's General-level rax. The docs example (18 × 1.6 = 28.8 → 29)
 * is consistent with round-to-nearest OR ceil; we use Math.round and flag rounding as unknown. The cap is applied by the
 * caller to the running annual total, not per claim.
 */
export function perClaimPayout(baseRax: number, key: string): number {
  const m = multiplierFor(key);
  return m === null ? 0 : Math.round(baseRax * m);
}

/** General-level annual total at which the cap starts to bind for a rung (cap ÷ multiplier). 500 for nearly every rung. */
export function capBindsAtGeneral(key: string): number | null {
  const rung = RARITY_LADDER.find((r) => r.key === key);
  const cap = rung?.annualCap.value;
  const m = rung?.multiplier.value;
  return cap && m ? cap / m : null;
}
