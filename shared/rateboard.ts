/**
 * Rateboard rules, ported 1:1 from the logic in https://rateboard-cgi.pages.dev
 * (name matching, offer floors, house list, copy-message maths, "best sellers" matching).
 *
 * Everything here is pure. All *state* (offers, accounts, collections) lives on
 * Rateboard's own backend and is reached through /api/proxy/rateboard — this file
 * only contains the rules the Rateboard front-end applies to that state, so that
 * messages and matches come out identical to what Rateboard itself would produce.
 *
 * Rateboard (rateboard-cgi.pages.dev) owns the original of everything in this file.
 */

export const RB_ORIGIN = 'https://rateboard-cgi.pages.dev';
export const RB_BOARD_KEY = 'ratebrd_market_v1';

export type RbSport = 'CFB' | 'FC' | 'NFL' | 'UFC' | 'NHL';
export const RB_SPORTS: Record<RbSport, string> = {
  CFB: 'College football',
  FC: 'FC',
  NFL: 'NFL',
  UFC: 'UFC',
  NHL: 'NHL',
};
/** Sports Rateboard can pull a collection for ("Pull my cards from Real"). */
export const RB_PULLABLE: RbSport[] = ['FC', 'CFB', 'NFL', 'UFC'];
export const RB_PLAYER_EXAMPLES: Record<RbSport, string> = {
  CFB: 'Julian Sayin',
  FC: 'Lamine Yamal',
  NFL: 'Josh Allen',
  UFC: 'Jon Jones',
  NHL: 'Connor McDavid',
};

export const MIN_PASS = 4;
export const MIN_TIER = 8;
export const CUSTOM_MAX = 9999;
export const RATES: number[] = (() => {
  const a = [MIN_TIER];
  for (let r = 10; r <= 120; r += 5) a.push(r);
  return a;
})();

/** The pinned post buyers must comment under. */
export const TARGET_LINK = 'https://www.realapp.com/NeH4tgFKo9k';
/** Real's comment permalinks use this longer internal id for that post. */
export const VERIFY_POST_ID = 'JaHBFYjOBj8igvOr';
export const TARGET_POST_PREFIX = `https://www.realapp.com/${VERIFY_POST_ID}/`;

export const HOUSE = {
  buyer: 'dennis',
  label: 'Seahawks',
  link: 'https://www.realapp.com/JaHBFYjOBj8igvOr/179049777342700001',
};

/* ------------------------------------------------------------------ */
/* Board shape (sanitised — password hashes and reports never reach us) */
/* ------------------------------------------------------------------ */

export interface RbUser {
  name: string;
  created?: number;
  banned?: boolean;
  /** True when the account has a password set. The hash itself is never exposed. */
  hasPassword: boolean;
}
export interface RbOffer {
  id: string;
  user: string;
  sport: RbSport;
  player: string;
  rate: number;
  link: string;
  ts: number;
}
export interface RbMinimum {
  id?: string;
  sport: RbSport;
  player: string;
  rate: number;
}
export interface RbKeep {
  id?: string;
  sport: RbSport;
  player: string;
  /** Position on Rateboard's keep list (1 = most wanted by the house), when it has one. */
  rank?: number;
}
export interface RbHouse {
  id?: string;
  sport: RbSport;
  player: string;
  rate: number;
}
export interface RbBoard {
  users: Record<string, RbUser>;
  offers: RbOffer[];
  minimums: RbMinimum[];
  keeplist: RbKeep[];
  house: RbHouse[];
}

export const blankBoard = (): RbBoard => ({ users: {}, offers: [], minimums: [], keeplist: [], house: [] });

/**
 * Reduce Rateboard's raw `/api/kv?key=ratebrd_market_v1` payload to what this
 * app needs. Drops every account's password hash, the private `reports` list and
 * the `gamedata` grant list — none of that is ours to re-serve.
 */
export function sanitizeBoard(raw: unknown): RbBoard {
  let m: any = raw;
  if (m && typeof m === 'object' && 'value' in m) m = (m as any).value;
  if (typeof m === 'string') m = JSON.parse(m);
  if (!m || typeof m !== 'object') return blankBoard();

  const users: Record<string, RbUser> = {};
  for (const [k, u] of Object.entries<any>(m.users || {})) {
    if (!u || typeof u !== 'object') continue;
    users[k] = {
      name: String(u.name ?? k),
      created: typeof u.created === 'number' ? u.created : undefined,
      banned: !!u.banned,
      hasPassword: !!u.hash,
    };
  }
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    users,
    offers: arr<RbOffer>(m.offers),
    minimums: arr<RbMinimum>(m.minimums),
    keeplist: arr<RbKeep>(m.keeplist),
    house: arr<RbHouse>(m.house),
  };
}

/* ------------------------------------------------------------------ */
/* Name matching                                                       */
/* ------------------------------------------------------------------ */

const ODD_LETTERS: Record<string, string> = {
  Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', ß: 'ss', Ø: 'O', ø: 'o', Ł: 'L', ł: 'l',
  Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Þ: 'Th', þ: 'th', İ: 'I', ı: 'i',
  Ħ: 'H', ħ: 'h', Ŋ: 'N', ŋ: 'n', Ŧ: 'T', ŧ: 't', Ŀ: 'L', ŀ: 'l',
};
const deOdd = (s: string) => String(s).replace(/[ÆæŒœßØøŁłĐđÐðÞþİıĦħŊŋŦŧĿŀ]/g, (c) => ODD_LETTERS[c] || c);

/** Plain-English form of a name, as Rateboard stores it: Mbappé -> Mbappe. */
export const asciiName = (s: string) =>
  deOdd(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const norm = (s: string) =>
  deOdd(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Suffix-sensitive key (Byron Murphy II vs Byron Murphy Jr. are different people). */
export const normSuffix = (s: string) =>
  deOdd(String(s))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Do two written names refer to the same player? Strict on purpose: two full
 * names must match outright; a bare surname matches in either direction.
 */
export function samePlayer(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xw = x.split(' ');
  const yw = y.split(' ');
  if (xw.length === 1 || yw.length === 1) return xw[xw.length - 1] === yw[yw.length - 1];
  return false;
}

/* ------------------------------------------------------------------ */
/* Floors, house list, offers                                          */
/* ------------------------------------------------------------------ */

/** The floor that applies to a player, or null. Highest wins. */
export function minimumFor(board: RbBoard, sport: RbSport, player: string): RbMinimum | null {
  const hits = board.minimums.filter((x) => x.sport === sport && samePlayer(x.player, player));
  if (!hits.length) return null;
  return [...hits].sort((a, b) => b.rate - a.rate)[0];
}

export type HouseHit = RbHouse & { exact: boolean };

export function houseFor(board: RbBoard, sport: RbSport, player: string): HouseHit | null {
  for (const h of board.house) {
    if (h.sport !== sport) continue;
    if (normSuffix(h.player) === normSuffix(player)) return { ...h, exact: true };
    if (samePlayer(h.player, player)) return { ...h, exact: false };
  }
  return null;
}

export function validCommentLink(link: unknown): boolean {
  return typeof link === 'string' && link.startsWith(TARGET_POST_PREFIX) && link.length > TARGET_POST_PREFIX.length;
}

export const rateLabel = (r: number) => (r === MIN_TIER ? `minimum (${r} / 1)` : `${r} / 1`);

/** Preset rates at or above `floor`. */
export const usableRates = (floor?: number | null) => RATES.filter((r) => !floor || r >= floor);

/** Live (non-banned) offers for a sport, best rate first (ties: oldest first). */
export function liveOffers(board: RbBoard, sport: RbSport): RbOffer[] {
  return board.offers
    .filter((o) => o.sport === sport && !board.users[o.user]?.banned)
    .sort((a, b) => b.rate - a.rate || a.ts - b.ts);
}

export type OfferCheck = { ok: true; player: string; rate: number } | { ok: false; error: string };

/** Client-side validation of a new offer, with the same messages Rateboard shows. */
export function checkNewOffer(
  board: RbBoard,
  sport: RbSport,
  playerRaw: string,
  link: string,
  rate: number | null,
  customTyped?: number,
): OfferCheck {
  const player = asciiName(playerRaw);
  if (player.length < 2) return { ok: false, error: 'Enter a player name.' };
  if (!validCommentLink(link.trim())) {
    return { ok: false, error: 'Paste the link to your comment under the pinned post first.' };
  }
  const hs = houseFor(board, sport, player);
  if (hs && hs.exact) {
    return { ok: false, error: `${hs.player} is on ${HOUSE.buyer}'s list at ${hs.rate}/1 — you can't post him.` };
  }
  const min = minimumFor(board, sport, player);
  if (rate == null || !Number.isFinite(rate)) {
    const typed = customTyped != null ? Math.round(customTyped) : NaN;
    if (min && typed >= 1 && typed < min.rate) {
      return { ok: false, error: `${min.player} has a ${min.rate}/1 minimum — you can't offer less.` };
    }
    return customTyped != null
      ? { ok: false, error: `Type the rate you'll pay — a whole number from 1 to ${CUSTOM_MAX}.` }
      : { ok: false, error: "Pick the rate you'll pay." };
  }
  if (min && rate < min.rate) {
    return { ok: false, error: `${min.player} has a ${min.rate}/1 minimum — you can't offer less.` };
  }
  return { ok: true, player, rate };
}

/**
 * Which option the rate dropdown should show, given its current value and the player's floor
 * (mirrors Rateboard's rateOptions/applyMinimumToForm): a rate below the floor is bumped up to it, and a
 * rate that isn't one of the preset tiers falls to "custom" so it is never silently snapped elsewhere.
 */
export function resolveRateSel(current: string, floor?: number | null): string {
  const base = current === 'custom' ? 'custom' : floor ? Math.max(+current || 0, floor) : +current || 20;
  const usable = usableRates(floor);
  if (base !== 'custom' && usable.includes(base)) return String(base);
  if (base === 'custom' || (+base > 0 && !RATES.includes(+base))) return 'custom';
  return String(usable[0] ?? 'custom');
}

/** Resolve a rate dropdown + custom box to a number (NaN when unusable). */
export function readRate(selValue: string, customValue: string, floor?: number | null): number {
  if (selValue !== 'custom') return +selValue;
  const v = Math.round(+customValue);
  if (!Number.isFinite(v) || v < 1 || v > CUSTOM_MAX) return NaN;
  if (floor && v < floor) return NaN;
  return v;
}

/* ------------------------------------------------------------------ */
/* Seller side: matching a collection against the board                */
/* ------------------------------------------------------------------ */

export interface SellerCard {
  name: string;
  boost?: number | null;
  owned?: number | null;
  totalValue?: number | null;
}

export interface Buyer {
  user: string;
  rate: number;
  buyer: string;
  link: string;
}
export interface Hit {
  player: string;
  value: number | null;
  buyers: Buyer[];
}
export interface BlockedCard {
  name: string;
  cfg: HouseHit;
  value: number | null;
}
export interface MatchResult {
  playerCount: number;
  rows: Hit[];
  noBuyer: SellerCard[];
  blocked: BlockedCard[];
  quicksells: SellerCard[];
  totalBuyers: number;
  /** Everything sold to its best buyer. */
  haul: number;
  /** Cards with a buyer but no rating read. */
  unpriced: number;
}

/** What a card is worth to a buyer: rating × rate, to the nearest 10. */
export const owedFor = (value: number, rate: number) => Math.round((value * rate) / 10) * 10;

/** The copy-message for one card + buyer: "i have <rating> <player> <owed>". */
export const copyMessage = (value: number, player: string, rate: number) =>
  `i have ${value} ${player} ${owedFor(value, rate)}`;

export const fmtVal = (v: number | null | undefined) =>
  v == null ? '' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

export function buildMatches(board: RbBoard, sport: RbSport, raw: Array<SellerCard | string>, excludes: string[]): MatchResult {
  const live = board.offers.filter((o) => o.sport === sport && !board.users[o.user]?.banned);

  const players = (raw || [])
    .map((p) => (typeof p === 'string' ? { name: p, boost: null, owned: null, totalValue: null } : p))
    .filter((p): p is SellerCard => !!p && !!p.name)
    .map((p) => ({ ...p, name: asciiName(p.name) }))
    .filter((p) => p.name);

  const valueOf = (p: SellerCard) => (p.totalValue != null ? p.totalValue : p.boost != null ? p.boost : null);
  const hits: Hit[] = [];
  const noBuyer: SellerCard[] = [];
  const blocked: BlockedCard[] = [];

  for (const p of players) {
    if (excludes.some((x) => samePlayer(x, p.name))) continue;
    const hs = houseFor(board, sport, p.name);
    if (hs) {
      blocked.push({ name: p.name, cfg: hs, value: valueOf(p) });
      continue;
    }
    const buyers: Buyer[] = live
      .filter((o) => samePlayer(o.player, p.name))
      .sort((a, b) => b.rate - a.rate)
      .map((o) => ({ user: o.user, rate: o.rate, buyer: board.users[o.user]?.name || o.user, link: o.link || '' }));
    if (buyers.length) hits.push({ player: p.name, value: valueOf(p), buyers });
    else noBuyer.push(p);
  }
  hits.sort((a, b) => b.buyers[0].rate - a.buyers[0].rate);

  // Quicksell suggestions: no buyer AND not on this sport's keep list. Without a
  // keep list we suggest nothing — "no offer yet" alone is never a reason to dump a card.
  const keep = board.keeplist.filter((k) => k.sport === sport);
  const qsSeen = new Set<string>();
  const quicksells = !keep.length
    ? []
    : noBuyer
        .filter((p) => !keep.some((k) => samePlayer(k.player, p.name)))
        .filter((p) => !qsSeen.has(norm(p.name)) && !!qsSeen.add(norm(p.name)));

  const seen = new Set<string>();
  const rows = hits.filter((h) => !seen.has(norm(h.player)) && !!seen.add(norm(h.player)));
  const totalBuyers = rows.reduce((n, h) => n + h.buyers.length, 0);
  const priced = rows.filter((h) => (h.value ?? 0) > 0);
  const haul = priced.reduce((sum, h) => sum + owedFor(h.value as number, h.buyers[0].rate), 0);

  return {
    playerCount: players.length,
    rows,
    noBuyer,
    blocked,
    quicksells,
    totalBuyers,
    haul,
    unpriced: rows.length - priced.length,
  };
}

export interface BestOffer {
  rate: number;
  /** Display name of the buyer (or the house buyer's label). */
  buyer: string;
  house: boolean;
}

/** Best standing price for one card: the house buyer's rate if he lists the player, else the top live offer. */
export function bestOfferFor(board: RbBoard, sport: RbSport, player: string): BestOffer | null {
  const hs = houseFor(board, sport, player);
  if (hs) return { rate: hs.rate, buyer: HOUSE.buyer, house: true };
  let best: BestOffer | null = null;
  for (const o of board.offers) {
    if (o.sport !== sport || board.users[o.user]?.banned || !samePlayer(o.player, player)) continue;
    if (!best || o.rate > best.rate) best = { rate: o.rate, buyer: board.users[o.user]?.name || o.user, house: false };
  }
  return best;
}

export interface BigOrderCard {
  player: string;
  value: number | null;
  rate: number;
  owed: number | null;
}
export interface BigOrder {
  user: string;
  who: string;
  link: string;
  cards: BigOrderCard[];
  total: number;
}

/** Buyers who want more than one of your cards — sell the lot in one message. */
export function bigOrders(rows: Hit[]): BigOrder[] {
  const per = new Map<string, { who: string; link: string; cards: BigOrderCard[] }>();
  for (const h of rows) {
    for (const b of h.buyers) {
      if (!per.has(b.user)) per.set(b.user, { who: b.buyer, link: b.link, cards: [] });
      const e = per.get(b.user)!;
      if (!e.link && b.link) e.link = b.link;
      e.cards.push({
        player: h.player,
        value: h.value,
        rate: b.rate,
        owed: (h.value ?? 0) > 0 ? owedFor(h.value as number, b.rate) : null,
      });
    }
  }
  return [...per.entries()]
    .filter(([, e]) => e.cards.length > 1)
    .map(([user, e]) => {
      const cards = [...e.cards].sort((a, b) => (b.owed ?? -1) - (a.owed ?? -1));
      return { user, who: e.who, link: e.link, cards, total: cards.reduce((n, c) => n + (c.owed || 0), 0) };
    })
    .sort((a, b) => b.total - a.total || b.cards.length - a.cards.length);
}

/** One message covering every priced card for a multi-card buyer. */
export function bigOrderMessage(e: BigOrder): string | null {
  const lines = e.cards.filter((c) => c.owed != null).map((c) => `i have ${c.value} ${c.player} ${c.owed}`);
  if (!lines.length) return null;
  return lines.join('\n') + (lines.length > 1 ? `\ntotal ${e.total.toLocaleString('en-US')}` : '');
}

/** The "haul" figure for the Big-orders view: each card counts once, at its best owed. */
export function bigOrdersHaul(orders: BigOrder[]): { amount: number; cards: number } {
  const best = new Map<string, number>();
  for (const e of orders) {
    for (const c of e.cards) {
      if (c.owed == null) continue;
      best.set(c.player, Math.max(best.get(c.player) || 0, c.owed));
    }
  }
  return { amount: [...best.values()].reduce((a, b) => a + b, 0), cards: best.size };
}

/** The single message for the house buyer covering every card they hold. */
export function houseMessage(blocked: BlockedCard[]): { msg: string; total: number; sure: BlockedCard[]; check: BlockedCard[] } {
  const sure = blocked.filter((b) => b.cfg.exact);
  const check = blocked.filter((b) => !b.cfg.exact);
  const owed = (b: BlockedCard) => ((b.value ?? 0) > 0 ? owedFor(b.value as number, b.cfg.rate) : null);
  const total = sure.reduce((n, b) => n + (owed(b) || 0), 0);
  const priced = sure.filter((b) => (b.value ?? 0) > 0);
  const msg = priced.map((b) => `i have ${b.value} ${b.name} ${owed(b)}`).join('\n') + (priced.length > 1 ? `\ntotal ${total.toLocaleString('en-US')}` : '');
  return { msg, total, sure, check };
}

/* ------------------------------------------------------------------ */
/* Password hashing (matches Rateboard exactly so accounts interoperate) */
/* ------------------------------------------------------------------ */

/**
 * Rateboard's board-password hash: SHA-256 of "rb1:" + password, hex, prefixed "s:".
 * (Falls back to the same non-cryptographic hash Rateboard uses where WebCrypto is unavailable.)
 * Computed in the browser — the plain password never leaves it.
 */
export async function hashPassword(str: string): Promise<string> {
  const salted = 'rb1:' + str;
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c && c.subtle && c.subtle.digest) {
    try {
      const b = await c.subtle.digest('SHA-256', new TextEncoder().encode(salted));
      return 's:' + [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch {
      /* fall through */
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < salted.length; i++) {
    const ch = salted.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch, 0x85ebca6b) >>> 0;
  }
  return 'f:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** The deep link out to Rateboard for a card (per the app spec). */
export function rateboardTradeUrl(cardId: string, sport?: string): string {
  const q = new URLSearchParams({ card: cardId, action: 'trade' });
  if (sport) q.set('sport', sport);
  return `${RB_ORIGIN}/?${q.toString()}`;
}
