/**
 * Server-side tools shared by the in-app assistant (`/api/chat`) and the MCP server (`/mcp`).
 *
 * Every tool here is pure/read-only: it reads the knowledge base, runs the site's own maths (shared/*.ts) or fetches the same
 * free public data the website shows. Nothing writes anywhere, so exposing them on a public, unauthenticated endpoint is safe.
 * Tools that change the *page* (navigate, set parameters) are NOT here — they only make sense in a browser and live in
 * src/agent (their JSON schemas are in shared/agent/clientTools.ts so the model can be told about them).
 */
import { americanToImplied, devig2, devig2Power, devigN, impliedToAmerican, ODDS_SPORTS, type OddsResponse, type OddsSport } from '../odds';
import { consensusFair } from '../oddsConsensus';
import { ICONIC_LEVELS, PACK_PRICES, PLAYOFF_MULTIPLIER, RARITY_LADDER, CLAIM_RULES, SPORT_RATING_FACTORS, SPORT_FACTORS_SOURCE, annualPayout, capBindsAtGeneral, multiplierFor, perClaimPayout, ratingToReach } from '../otdRules';
import { cloneParams, estimateCardPrice } from '../otdPricing';
import { QUAD_PAYOUTS, SQUAD_SIZE } from '../quads';
import { breakEvenPct, DEFAULT_REAL_RULES, evPct, kellyFraction, payoutMultiple, recommendStake, type RealRules } from '../realPayout';
import { copyMessage, owedFor } from '../rateboard';
import type { QuadGame } from '../sample';
import { evaluate } from './calc';
import { SITE_TABS } from './siteMap';
import type { KbDocMeta } from './kbCore';

/* --------------------------------- types -------------------------------- */

export interface KbDocText {
  meta: KbDocMeta;
  chunks: string[];
}
export interface KbHitText {
  doc: string;
  docTitle: string;
  heading: string;
  url: string;
  source: KbDocMeta['source'];
  score: number;
  text: string;
}
/** How tools reach the knowledge base. The edge implements it over static assets; tests over in-memory data. */
export interface KbAccess {
  search(query: string, limit: number, opts?: { source?: KbDocMeta['source'] }): Promise<KbHitText[]>;
  docs(): Promise<KbDocMeta[]>;
  read(docId: string): Promise<KbDocText | null>;
  /** The slim OTD card table built by scripts/build-kb.mjs (null if unavailable). */
  otdIndex(): Promise<OtdIndex | null>;
}
export interface OtdIndex {
  generatedAt: string;
  source: string;
  method: string;
  /** [id, sport, seasonLabel, name, team, owners, annualGeneralRax, bestGame, games] */
  cards: Array<[string, string, string, string, string, number | null, number, number, number]>;
}
export interface ToolCtx {
  kb: KbAccess;
  /** GET one of this site's own JSON endpoints (e.g. `/api/odds/events?sport=NBA`). Absent in unit tests that don't need it. */
  getJson?: (pathAndQuery: string) => Promise<unknown>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: false;
}
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Offered to the in-app model too? Heavy/rarely useful tools are MCP-only to keep the chat prompt small. */
  chat: boolean;
  /** `false` keeps a tool out of the public MCP server (chat-only helpers such as the feature-request email). */
  mcp?: false;
  /** Terser description for the in-app model (every prompt token costs free-tier neurons); MCP clients get `description`. */
  chatDescription?: string;
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

/** Thrown for bad input; surfaced to the model/client as a normal tool error, not a crash. */
export class ToolError extends Error {}

/* ------------------------------- arg helpers ---------------------------- */

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function numArg(a: Record<string, unknown>, k: string, o: { min?: number; max?: number; def?: number; required?: boolean } = {}): number | undefined {
  let v = a[k];
  if (typeof v === 'string' && v.trim() !== '') v = Number(v.replace(/[,%$\s]/g, ''));
  if (v === undefined || v === null || v === '') {
    if (o.required) throw new ToolError(`"${k}" is required.`);
    return o.def;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolError(`"${k}" must be a number.`);
  if (o.min !== undefined && v < o.min) throw new ToolError(`"${k}" must be ≥ ${o.min}.`);
  if (o.max !== undefined && v > o.max) throw new ToolError(`"${k}" must be ≤ ${o.max}.`);
  return v;
}
function strArg(a: Record<string, unknown>, k: string, o: { required?: boolean; def?: string; max?: number } = {}): string | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === '') {
    if (o.required) throw new ToolError(`"${k}" is required.`);
    return o.def;
  }
  if (typeof v !== 'string') throw new ToolError(`"${k}" must be a string.`);
  return v.slice(0, o.max ?? 500);
}
function enumArg<T extends string>(a: Record<string, unknown>, k: string, allowed: readonly T[], def?: T): T | undefined {
  const v = a[k];
  if (v === undefined || v === null || v === '') return def;
  const hit = allowed.find((x) => x.toLowerCase() === String(v).toLowerCase());
  if (!hit) throw new ToolError(`"${k}" must be one of: ${allowed.join(', ')}.`);
  return hit;
}
const r = (x: number, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const prob = (x: number) => (x > 1 ? x / 100 : x);

/* --------------------------------- tools -------------------------------- */

export const FEATURE_EMAIL = 'rax@vivaanshahani.com';

/** encodeURIComponent leaves ( ) ! ' * alone; they would end a markdown link early, so encode them too. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function draftFeatureEmail(title: string, details: string, tab?: string) {
  const clean = (x: string) => x.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const subject = `RAX feature request: ${clean(title)}`;
  const body = [
    'Hi,',
    '',
    "I was using the RAX site (rax.vivaanshahani.com) and asked its assistant for something it can't do yet:",
    '',
    clean(details),
    ...(tab ? ['', `Related tab: ${clean(tab)}`] : []),
    '',
    'Could you add this? Thanks!',
  ].join('\n');
  return {
    email: FEATURE_EMAIL,
    subject,
    body,
    mailto: `mailto:${FEATURE_EMAIL}?subject=${enc(subject)}&body=${enc(body)}`,
    instruction: 'Tell the user in one line that the site cannot do this yet. Show the draft (subject + body) as a block quote, then give the link as [Email the developer](<mailto>) copied exactly. Do not promise it will be built.',
  };
}

const SOURCES = ['real-docs', 'rax-docs', 'site-guide'] as const;
const RUNG_NAMES = [...RARITY_LADDER.filter((l) => l.key !== 'General').map((l) => l.key), ...ICONIC_LEVELS.map((l) => l.key)];

function rungInfo(key: string) {
  const norm = RUNG_NAMES.find((k) => k.toLowerCase() === key.toLowerCase().trim()) ?? (key.toLowerCase().trim() === 'iconic 1' ? 'Iconic' : undefined);
  if (!norm) throw new ToolError(`Unknown rarity "${key}". Valid: ${RUNG_NAMES.join(', ')} (Iconic = Iconic 1).`);
  return norm;
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'search_docs',
    title: 'Search Real & RAX docs',
    description:
      "Search the knowledge base: Real's own public docs (docs.realapp.link — cards, Rax, Karma, OTD, Pro, packs, Arena, changelog), this site's research notes (OTD mechanics, odds sources, Rateboard, rating model) and the site guide. Returns the best-matching passages with their source URL. Use this before answering any question about how Real or this site works.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look up, e.g. "legendary 3 multiplier", "pro bonus claim", "how is EV computed".' },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'Passages to return (default 4).' },
        source: { type: 'string', enum: [...SOURCES], description: "Restrict to Real's docs, this repo's notes, or the site guide." },
      },
      required: ['query'],
      additionalProperties: false,
    },
    chatDescription: "Search Real's public docs, this site's notes and the site guide; returns passages with source URLs. Use for any 'how does X work' question.",
    chat: true,
    async handler(a, ctx) {
      const query = strArg(a, 'query', { required: true, max: 300 })!;
      const hits = await ctx.kb.search(query, numArg(a, 'limit', { min: 1, max: 8, def: 4 })!, { source: enumArg(a, 'source', SOURCES) });
      return {
        query,
        results: hits.map((h) => ({ title: h.docTitle, section: h.heading, source: h.source, url: h.url, text: h.text.length > 1100 ? `${h.text.slice(0, 1100)}…` : h.text })),
        note: hits.length ? undefined : 'No matching passages — try different keywords.',
      };
    },
  },
  {
    name: 'read_doc',
    title: 'Read a whole document',
    description: 'Read one knowledge-base document in full (or list them all with no id). Ids look like "real-collect-player-cards", "rax-otd-mechanics", "rax-site-guide".',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Document id from search_docs results or the list. Omit to list documents.' } }, additionalProperties: false },
    chat: false,
    async handler(a, ctx) {
      const id = strArg(a, 'id');
      if (!id) return { documents: (await ctx.kb.docs()).map((d) => ({ id: d.id, title: d.title, source: d.source, url: d.url, chunks: d.chunks })) };
      const doc = await ctx.kb.read(id);
      if (!doc) throw new ToolError(`No document "${id}". Call read_doc with no id to list them.`);
      return { id, title: doc.meta.title, url: doc.meta.url, text: doc.chunks.join('\n\n') };
    },
  },
  {
    name: 'list_tabs',
    title: 'List the site\'s tabs',
    description: 'The tabs of rax.vivaanshahani.com with their routes and what each does.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    chat: false,
    async handler() {
      return { site: 'https://rax.vivaanshahani.com', tabs: SITE_TABS.map((t) => ({ tab: t.n, id: t.id, route: t.route, label: t.label, summary: t.summary })), note: 'There is no Tab 4 (retired).' };
    },
  },
  {
    name: 'otd_rules',
    title: 'OTD / card rules tables',
    description:
      "Real's card rules as encoded in this site: the rarity ladder (multiplier, total rating needed, annual OTD cap), per-sport rating→Rax factors, OTD claim rules (with how certain each is), or pack prices.",
    inputSchema: { type: 'object', properties: { section: { type: 'string', enum: ['ladder', 'sport_factors', 'claims', 'packs'] } }, required: ['section'], additionalProperties: false },
    chatDescription: 'Card rules tables: section = ladder (multiplier, rating needed, cap), sport_factors, claims, packs.',
    chat: true,
    async handler(a) {
      const section = enumArg(a, 'section', ['ladder', 'sport_factors', 'claims', 'packs'] as const)!;
      if (section === 'ladder')
        return {
          note: 'multiplier × General-level Rax = payout per claim; annual cap below Iconic; Iconic uncapped. Level = summed rating of the Play cards you own for that player-season.',
          rungs: [
            ...RARITY_LADDER.filter((l) => l.key !== 'General').map((l) => ({ rarity: l.key, multiplier: l.multiplier.value, totalRating: l.cumulativeRating.value, annualCap: l.annualCap.value })),
            ...ICONIC_LEVELS.map((l) => ({ rarity: l.key, multiplier: l.multiplier, totalRating: l.cumulativeRating, annualCap: null })),
          ],
        };
      if (section === 'sport_factors') return { source: SPORT_FACTORS_SOURCE, ratingToRaxFactors: SPORT_RATING_FACTORS, playoffsAndMajors: `${PLAYOFF_MULTIPLIER.value}× the regular-season base`, note: 'Base Rax per game = Real rating × factor.' };
      if (section === 'claims') return Object.fromEntries(Object.entries(CLAIM_RULES).map(([k, f]) => [k, { value: f.value, confidence: f.confidence }]));
      return Object.fromEntries(Object.entries(PACK_PRICES).map(([k, f]) => [k, { raxPrice: f.value, confidence: f.confidence }]));
    },
  },
  {
    name: 'otd_payout',
    title: 'OTD payout & payback calculator',
    description:
      'Payout of one card at a rarity: annual OTD payout = min(cap, multiplier × Σ General-level Rax of the season); per-claim payout for a given day; cost to reach the rarity (200 claim + total rating × Rax-per-rating) and payback time. Rarity names: Common, Uncommon, Rare, Epic, Legendary 1-5, Mystic 1-10, Iconic (=Iconic 1), Iconic 2-20.',
    inputSchema: {
      type: 'object',
      properties: {
        rarity: { type: 'string', description: 'e.g. "Iconic", "Legendary 3".' },
        generalRaxPerSeason: { type: 'number', description: "Σ of the card's per-game General-level Rax for the season (e.g. 700 for a top NFL season)." },
        baseRaxForDay: { type: 'number', description: "One day's General-level Rax, for a per-claim payout." },
        ratePerRating: { type: 'number', description: 'Rax per rating point of play cards (default 10, Rateboard median).' },
      },
      required: ['rarity'],
      additionalProperties: false,
    },
    chatDescription: "Payout of one card at a rarity: annual payout from season General Rax, per-claim payout for a day, cost to reach it, payback days. Rarity e.g. 'Iconic', 'Legendary 3'.",
    chat: true,
    async handler(a) {
      const key = rungInfo(strArg(a, 'rarity', { required: true })!);
      const mult = multiplierFor(key)!;
      const rating = ratingToReach(key)!;
      const rate = numArg(a, 'ratePerRating', { min: 0, def: 10 })!;
      const general = numArg(a, 'generalRaxPerSeason', { min: 0 });
      const day = numArg(a, 'baseRaxForDay', { min: 0 });
      const cost = 200 + rating * rate;
      const out: Record<string, unknown> = { rarity: key, multiplier: mult, totalRatingNeeded: rating, capBindsAtGeneralRax: capBindsAtGeneral(key), costRax: Math.round(cost), costBasis: `200 claim + ${rating} rating × ${rate} Rax/rating (an estimate — Real publishes no prices)` };
      if (general !== undefined) {
        const pay = annualPayout(general, key);
        out.annualPayoutRax = Math.round(pay);
        out.uncappedRax = Math.round(general * mult);
        out.capped = pay < general * mult;
        out.paybackDays = pay > 0 ? Math.round(cost / (pay / 365)) : null;
        out.note = 'Assumes you claim every anniversary, ignores overlaps and the 2-claims-per-sport-per-day limit; the site\'s Tab 7 handles those.';
      }
      if (day !== undefined) out.perClaimRax = perClaimPayout(day, key);
      return out;
    },
  },
  {
    name: 'otd_top_cards',
    title: 'Top OTD cards by annual earnings',
    description:
      'Rank the best cards in the observed OTD dataset (Real per-game Rax logged by Rateboard; top ~150 per sport) by full-year payout at a rarity, or by fastest payback. Quick lookup — the OTD Efficiency tab (Tab 7) adds timeframes, overlaps and combinations.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: ['NFL', 'NBA', 'MLB', 'NHL', 'CBB', 'CFB', 'PGA', 'WNBA', 'SOC'], description: 'Omit for all sports.' },
        rarity: { type: 'string', description: 'Default "Iconic".' },
        ratePerRating: { type: 'number', description: 'Default 10.' },
        sortBy: { type: 'string', enum: ['payout', 'payback'] },
        player: { type: 'string', description: 'Only cards whose name contains this.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
    chatDescription: 'Best OTD cards in the observed dataset by annual payout or payback at a rarity (optional sport/player filter). Full-year, ignores overlaps.',
    chat: true,
    async handler(a, ctx) {
      const idx = await ctx.kb.otdIndex();
      if (!idx) throw new ToolError('The OTD dataset is not available right now.');
      const sport = strArg(a, 'sport')?.toUpperCase();
      const key = rungInfo(strArg(a, 'rarity', { def: 'Iconic' })!);
      const rate = numArg(a, 'ratePerRating', { min: 1, def: 10 })!;
      const sortBy = enumArg(a, 'sortBy', ['payout', 'payback'] as const, 'payout')!;
      const player = strArg(a, 'player')?.toLowerCase();
      const limit = numArg(a, 'limit', { min: 1, max: 25, def: 10 })!;
      const pp = cloneParams();
      pp.ratePerRating.mid.value = rate;
      const rows = idx.cards
        .filter(([, s, , name]) => (!sport || s === sport) && (!player || name.toLowerCase().includes(player)))
        .map(([id, s, label, name, team, owners, annual, best, games]) => {
          const pay = annualPayout(annual, key);
          const price = estimateCardPrice({ id, sport: s, season: 0, name, annual, owners }, key, pp).price;
          return { card: `${name} ${label}`, sport: s, team, generalRaxPerSeason: annual, bestGameGeneralRax: best, games, annualPayoutRax: Math.round(pay), estCostRax: Math.round(price), paybackDays: pay > 0 ? Math.round(price / (pay / 365)) : null };
        });
      rows.sort(sortBy === 'payout' ? (x, y) => y.annualPayoutRax - x.annualPayoutRax : (x, y) => (x.paybackDays ?? 1e9) - (y.paybackDays ?? 1e9));
      return { rarity: key, ratePerRating: rate, sortedBy: sortBy, dataset: `${idx.method} snapshot, ${idx.generatedAt.slice(0, 10)}`, cards: rows.slice(0, limit), note: 'Full-year payout if every anniversary is claimed; ignores overlaps and the claim limit. Costs are estimates.' };
    },
  },
  {
    name: 'ev_calc',
    title: 'Real prediction EV / Kelly calculator',
    description:
      "Expected value of buying a side in Real's prediction market. Give your fair win probability (from Kalshi/Polymarket/sportsbook consensus, vig removed) and the % Real displays. Model: a YES share priced at the displayed % pays 1 Rax; net multiple = (100/pct)×(1−rake). Returns EV%, break-even %, the edge, and (with a bankroll) a fractional-Kelly stake. Real's rake is unknown — default 5%, editable.",
    inputSchema: {
      type: 'object',
      properties: {
        fairProb: { type: 'number', description: 'Fair probability, 0–1 or 0–100 (e.g. 0.62 or 62).' },
        realPct: { type: 'number', description: 'The percentage Real shows for that side (0.5–99.5).' },
        rake: { type: 'number', description: 'Fee fraction (0.05) or percent (5). Default 0.05.' },
        rakeBasis: { type: 'string', enum: ['payout', 'profit'], description: 'Rake taken from the whole payout (default) or only the profit.' },
        bankroll: { type: 'number', description: 'Rax. Enables a Kelly stake recommendation.' },
        kellyFraction: { type: 'number', description: 'Fraction of full Kelly, default 0.25.' },
      },
      required: ['fairProb', 'realPct'],
      additionalProperties: false,
    },
    chatDescription: "EV%, break-even %, edge and Kelly stake for Real's prediction market from a fair probability and the % Real shows (default rake 5%, unknown in reality).",
    chat: true,
    async handler(a) {
      const fair = prob(numArg(a, 'fairProb', { required: true, min: 0, max: 100 })!);
      if (!(fair > 0 && fair < 1)) throw new ToolError('"fairProb" must be between 0 and 1 (or 0–100), exclusive.');
      const pct = numArg(a, 'realPct', { required: true, min: 0.5, max: 99.5 })!;
      let rake = numArg(a, 'rake', { min: 0, max: 50, def: DEFAULT_REAL_RULES.rake })!;
      if (rake > 0.5) rake /= 100;
      const rules: RealRules = { ...DEFAULT_REAL_RULES, rake, rakeBasis: enumArg(a, 'rakeBasis', ['payout', 'profit'] as const, 'payout')! };
      const mult = payoutMultiple(pct, rules);
      const ev = evPct(fair, pct, rules);
      const be = breakEvenPct(fair, rules);
      const positive = ev > 0;
      const out: Record<string, unknown> = {
        // the plain-language answer first, so a model reading this can't flip the sign
        answer: positive
          ? `YES, +EV: buying at Real's ${pct}% has expected value of +${r(ev)}% of the stake (fair probability ${r(fair * 100)}% is HIGHER than Real's ${pct}%, so the payout is more than the risk). Buy only while Real shows less than ${r(be)}%.`
          : `NO, not +EV: buying at Real's ${pct}% has expected value of ${r(ev)}% of the stake (fair probability ${r(fair * 100)}% is NOT high enough to cover Real's price and rake). It would need Real to show less than ${r(be)}%.`,
        isPositiveEv: positive,
        evPct: r(ev),
        edgePp: r(fair * 100 - pct),
        fairProbPct: r(fair * 100), realPct: pct, breakEvenRealPct: r(be),
        netPayoutMultiple: r(mult, 4), rake, rakeBasis: rules.rakeBasis,
        fullKellyFraction: r(kellyFraction(fair, mult), 4),
        caveat: "Real's rake, stake limits and price impact are unknown; the fair probability is only as good as the sources. Not financial advice.",
      };
      const bankroll = numArg(a, 'bankroll', { min: 0 });
      if (bankroll) {
        const rec = recommendStake(fair, pct, bankroll, rules, numArg(a, 'kellyFraction', { min: 0.01, max: 1, def: 0.25 })!);
        out.recommendedStakeRax = rec.stake;
        out.stakeNote = rec.note;
      }
      return out;
    },
  },
  {
    name: 'odds_convert',
    title: 'Odds converter',
    description: 'Convert between American odds, decimal odds, fractional odds and implied probability. Give exactly one of american, decimal, fractional ("5/2") or probability.',
    inputSchema: {
      type: 'object',
      properties: {
        american: { type: 'number', description: 'e.g. -150 or +130.' },
        decimal: { type: 'number', description: 'e.g. 2.5.' },
        fractional: { type: 'string', description: 'e.g. "5/2".' },
        probability: { type: 'number', description: '0–1 or 0–100.' },
      },
      additionalProperties: false,
    },
    chatDescription: 'Convert American/decimal/fractional odds and probability (give exactly one).',
    chat: true,
    async handler(a) {
      let p: number;
      if (a.american !== undefined) p = americanToImplied(numArg(a, 'american', { required: true })!);
      else if (a.decimal !== undefined) p = 1 / numArg(a, 'decimal', { required: true, min: 1.0001 })!;
      else if (a.fractional !== undefined) {
        const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(a.fractional));
        if (!m || +m[2] === 0) throw new ToolError('"fractional" must look like "5/2".');
        p = +m[2] / (+m[1] + +m[2]);
      } else if (a.probability !== undefined) p = prob(numArg(a, 'probability', { required: true, min: 0, max: 100 })!);
      else throw new ToolError('Give one of american, decimal, fractional, probability.');
      if (!(p > 0 && p < 1)) throw new ToolError('That input does not map to a probability between 0 and 1.');
      const dec = 1 / p;
      return { probabilityPct: r(p * 100, 3), american: impliedToAmerican(p), decimal: r(dec, 4), fractional: `${r(dec - 1, 3)}/1`, note: 'Probability is the vig-inclusive implied probability of that price.' };
    },
  },
  {
    name: 'devig',
    title: 'Remove the vig from a market',
    description: 'Turn a bookmaker\'s prices on all outcomes into fair (no-vig) probabilities. Methods: proportional (default) or power (two-way only). Give american odds or implied probabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        american: { type: 'array', items: { type: 'number' }, description: 'American odds of every outcome, e.g. [-130, 110].' },
        probabilities: { type: 'array', items: { type: 'number' }, description: 'Implied probabilities (0–1) of every outcome.' },
        method: { type: 'string', enum: ['proportional', 'power'] },
      },
      additionalProperties: false,
    },
    chatDescription: 'Remove the vig from outcome odds (american[] or probabilities[]) → fair probabilities.',
    chat: true,
    async handler(a) {
      const am = Array.isArray(a.american) ? (a.american as unknown[]).map(Number) : null;
      const pr = Array.isArray(a.probabilities) ? (a.probabilities as unknown[]).map(Number) : null;
      const implied = am ? am.map(americanToImplied) : pr;
      if (!implied || implied.length < 2 || implied.length > 6 || implied.some((x) => !(x > 0 && x < 1))) throw new ToolError('Give 2–6 outcomes as american odds or probabilities strictly between 0 and 1.');
      const method = enumArg(a, 'method', ['proportional', 'power'] as const, 'proportional')!;
      const fair = implied.length === 2 && method === 'power' ? devig2Power(implied[0], implied[1]) : implied.length === 2 ? devig2(implied[0], implied[1]) : devigN(implied);
      const over = implied.reduce((x, y) => x + y, 0);
      return { method: implied.length > 2 ? 'proportional (power is two-way only)' : method, impliedPct: implied.map((x) => r(x * 100, 2)), overroundPct: r((over - 1) * 100, 2), fairPct: fair.map((x) => r(x * 100, 2)), fairAmerican: fair.map((x) => impliedToAmerican(x)) };
    },
  },
  {
    name: 'live_odds',
    title: 'Live fair odds for upcoming games',
    description:
      'Upcoming games with consensus no-vig win probabilities from Kalshi, Polymarket and DraftKings (via ESPN) — the same data as Tab 9. Free public sources, cached ~45 s; can lag or be partial.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: [...ODDS_SPORTS], description: 'Required.' },
        team: { type: 'string', description: 'Only games involving a team whose name contains this.' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['sport'],
      additionalProperties: false,
    },
    chatDescription: 'Upcoming games with consensus no-vig win probabilities (Kalshi, Polymarket, DraftKings) for one sport.',
    chat: true,
    async handler(a, ctx) {
      if (!ctx.getJson) throw new ToolError('Live data is not available in this context.');
      const sport = enumArg(a, 'sport', ODDS_SPORTS as readonly OddsSport[])!;
      if (!sport) throw new ToolError('"sport" is required.');
      const team = strArg(a, 'team')?.toLowerCase();
      const limit = numArg(a, 'limit', { min: 1, max: 20, def: 8 })!;
      const data = (await ctx.getJson(`/api/odds/events?sport=${sport}`)) as OddsResponse;
      const events = data.events.filter((e) => e.status !== 'final' && (!team || `${e.home} ${e.away}`.toLowerCase().includes(team))).slice(0, limit);
      return {
        sport, generatedAt: data.generatedAt,
        sources: data.sources.map((s) => ({ source: s.source, ok: s.ok, note: s.error })),
        games: events.map((e) => {
          const ml = consensusFair(e, 'moneyline', null);
          const sp = e.markets.some((m) => m.type === 'spread') ? consensusFair(e, 'spread') : null;
          const tot = e.markets.some((m) => m.type === 'total') ? consensusFair(e, 'total') : null;
          return {
            game: `${e.away} @ ${e.home}`, startsAt: e.startsAt, approxTime: e.startApprox || undefined, status: e.status,
            moneyline: ml.fair ? { [e.home]: r(ml.fair[0] * 100, 1), [e.away]: r(ml.fair[1] * 100, 1), ...(ml.draw ? { draw: r(ml.draw * 100, 1) } : {}), sources: ml.sources.map((s) => s.source), confidence: ml.confidence, disagreementPp: ml.spread === null ? undefined : r(ml.spread * 100, 1) } : undefined,
            spread: sp?.fair ? { homeLine: sp.line, homeCoverPct: r(sp.fair[0] * 100, 1) } : undefined,
            total: tot?.fair ? { line: tot.line, overPct: r(tot.fair[0] * 100, 1) } : undefined,
          };
        }),
        note: 'Percentages are fair (no-vig) probabilities. Compare with the % Real shows using ev_calc.',
      };
    },
  },
  {
    name: 'schedule',
    title: 'Upcoming games',
    description: 'Upcoming games (teams, start time, broadcaster, marquee flag) for NFL, NBA, MLB, NHL, CFB, CBB from ESPN\'s public scoreboards — the data behind Tab 6 (Quads).',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: ['NFL', 'NBA', 'MLB', 'NHL', 'CFB', 'CBB'] },
        days: { type: 'integer', minimum: 1, maximum: 5 },
        marqueeOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    chatDescription: 'Upcoming games (teams, time, broadcaster) for NFL/NBA/MLB/NHL/CFB/CBB.',
    chat: true,
    async handler(a, ctx) {
      if (!ctx.getJson) throw new ToolError('Live data is not available in this context.');
      const days = numArg(a, 'days', { min: 1, max: 5, def: 3 })!;
      const sport = strArg(a, 'sport')?.toUpperCase();
      const data = (await ctx.getJson(`/api/intel/schedule?days=${days}`)) as { source: string; games: QuadGame[]; note?: string };
      const games = data.games.filter((g) => (!sport || g.sport === sport) && (!a.marqueeOnly || g.marquee)).slice(0, numArg(a, 'limit', { min: 1, max: 30, def: 12 })!);
      return { source: data.source, note: data.note, games: games.map((g) => ({ sport: g.sport, game: `${g.away} @ ${g.home}`, startsAt: g.startsAt, broadcast: g.broadcast || undefined, marquee: g.marquee, status: g.status })) };
    },
  },
  {
    name: 'rateboard_owed',
    title: 'Rateboard owed-Rax & copy message',
    description: 'What a buyer owes for a card at a Rateboard rate: rating × rate rounded to the nearest 10 Rax, plus the exact copy-message Rateboard buyers expect ("i have <rating> <player> <owed>").',
    inputSchema: {
      type: 'object',
      properties: { rating: { type: 'number', description: 'Card rating, e.g. 87.' }, rate: { type: 'number', description: 'Rate in Rax per rating point (e.g. 20 for "20/1"; the floor is 8).' }, player: { type: 'string' } },
      required: ['rating', 'rate'],
      additionalProperties: false,
    },
    chatDescription: 'Rax a buyer owes for a card (rating × rate, nearest 10) plus the Rateboard copy message.',
    chat: true,
    async handler(a) {
      const rating = numArg(a, 'rating', { required: true, min: 0 })!;
      const rate = numArg(a, 'rate', { required: true, min: 0 })!;
      const player = strArg(a, 'player', { def: '<player>', max: 80 })!;
      return { owedRax: owedFor(rating, rate), message: copyMessage(rating, player, rate), note: 'Rounded to the nearest 10 Rax, as Rateboard does.' };
    },
  },
  {
    name: 'quads_payouts',
    title: 'Quads payout reference',
    description: 'Rax per teammate for each Quads finishing tier, and the squad total (squads have 4 players).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    chat: false,
    async handler() {
      return { squadSize: SQUAD_SIZE, tiers: QUAD_PAYOUTS.map((t) => ({ ...t, squadTotal: t.raxPerTeammate * SQUAD_SIZE })) };
    },
  },
  {
    name: 'calculate',
    title: 'Calculator',
    description: 'Evaluate an arithmetic expression exactly: + - * / ^ %, parentheses, sqrt abs round floor ceil ln log exp pow min max avg sum, constants pi e. "15%" is 0.15. Use this for any non-trivial arithmetic instead of computing in your head.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. "(1200*0.35 + 300) / 12".' } }, required: ['expression'], additionalProperties: false },
    chatDescription: "Exact arithmetic: + - * / ^ %, parentheses, sqrt/round/min/max/avg…; '15%' = 0.15. Use for any non-trivial maths.",
    chat: true,
    async handler(a) {
      const expression = strArg(a, 'expression', { required: true, max: 400 })!;
      try {
        const result = evaluate(expression);
        return { expression, result: Math.abs(result) >= 1e15 || (result !== 0 && Math.abs(result) < 1e-9) ? result : Math.round(result * 1e10) / 1e10 };
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : 'Could not evaluate that expression.');
      }
    },
  },
  {
    name: 'request_feature',
    title: 'Ask the developer for a feature',
    description: "Build a pre-written email to the site's developer asking for a feature, calculation or data source this site can't do. Returns a mailto link and the draft.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name of the request, e.g. "Parlay EV calculator".' },
        details: { type: 'string', description: 'What the user wants, in their words plus any numbers/examples they gave, written so the developer can act on it without a follow-up.' },
        tab: { type: 'string', description: 'Which tab it relates to, if any.' },
      },
      required: ['title', 'details'],
      additionalProperties: false,
    },
    chatDescription: "ONLY when the user asks for a feature, calculation, tab or data this site truly can't do (after checking your other tools): returns the mailto link + draft email to the developer.",
    chat: true,
    mcp: false,
    async handler(a) {
      return draftFeatureEmail(strArg(a, 'title', { required: true, max: 90 })!, strArg(a, 'details', { required: true, max: 900 })!, strArg(a, 'tab', { max: 40 }));
    },
  },
];

export const MCP_TOOLS = TOOLS.filter((t) => t.mcp !== false);

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const getTool = (name: string): ToolSpec | undefined => BY_NAME.get(name);

/** Run a tool by name; returns `{ok:true,result}` or `{ok:false,error}` — never throws for bad input. */
export async function runTool(name: string, args: unknown, ctx: ToolCtx): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const t = BY_NAME.get(name);
  if (!t) return { ok: false, error: `Unknown tool "${name}".` };
  const a = isObj(args) ? args : {};
  try {
    return { ok: true, result: await t.handler(a, ctx) };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message };
    return { ok: false, error: `Tool "${name}" failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
