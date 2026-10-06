/**
 * Schema-agnostic importer: paste any JSON response you copied from your own session (browser DevTools or a
 * proxy tool) and map its fields onto auction bids. Nothing here knows Real's real response shape — it finds
 * the list, guesses which keys mean what, and lets you correct the guesses.
 * Runs entirely in the browser: pasted data is never uploaded.
 */
import type { AuctionBid } from '../src/types/market';
import type { Rarity, Sport } from '../src/types/real';
import { RARITIES, SPORTS, perRatingPrice } from './formulas';

export type Field = 'playerName' | 'sport' | 'rarity' | 'rating' | 'bid' | 'bidder' | 'bidderId' | 'auctionId' | 'timestamp' | 'expiresAt' | 'status';
export const FIELDS: Array<{ key: Field; label: string; required: boolean }> = [
  { key: 'playerName', label: 'Player name', required: true },
  { key: 'sport', label: 'Sport', required: true },
  { key: 'rarity', label: 'Rarity', required: true },
  { key: 'rating', label: 'Card rating', required: true },
  { key: 'bid', label: 'Highest bid (Rax)', required: true },
  { key: 'bidder', label: 'Bidder username', required: true },
  { key: 'bidderId', label: 'Bidder user id', required: false },
  { key: 'auctionId', label: 'Auction id', required: false },
  { key: 'timestamp', label: 'Bid time', required: false },
  { key: 'expiresAt', label: 'Auction end time', required: false },
  { key: 'status', label: 'Status', required: false },
];

/** A mapping entry is either a JSON path in each row, or a constant (e.g. every row is NFL). */
export type Source = { path: string } | { value: string };
export type Mapping = Partial<Record<Field, Source>>;

type Row = Record<string, unknown>;
const isObj = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);

/** Find the biggest array of objects in the JSON (up to 3 levels deep). */
export function findRows(json: unknown): { rows: Row[]; path: string } {
  let best: { rows: Row[]; path: string } = { rows: [], path: '' };
  const walk = (node: unknown, path: string, depth: number) => {
    if (Array.isArray(node)) {
      const objs = node.filter(isObj);
      if (objs.length > best.rows.length) best = { rows: objs, path };
      return;
    }
    if (isObj(node) && depth < 3) for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(json, '', 0);
  return best;
}

/** Flatten a row to dot-paths of primitive values (arrays are skipped). */
export function flatten(row: Row, prefix = '', depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(row)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) {
      if (depth < 4) flatten(v, p, depth + 1, out);
    } else if (!Array.isArray(v)) out[p] = v;
  }
  return out;
}

export function getPath(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const seg of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Ordered regexes (first match wins) over the lower-cased dotted path. */
const GUESS: Record<Field, RegExp[]> = {
  playerName: [/(^|\.)(player|card)\.?(full|display)?name$/, /(^|\.)playername$/, /(^|\.)player\.name$/, /(^|\.)(full|display)name$/],
  sport: [/(^|\.)sport(s)?(slug|name|key)?$/, /(^|\.)league$/],
  rarity: [/(^|\.)rarity(name|slug)?$/, /(^|\.)tier$/],
  rating: [/(^|\.)(card)?rating$/, /(^|\.)(overall|ovr)$/],
  bid: [/(^|\.)(highest|current|top|winning)bid\.?(rax|amount|value)$/, /(^|\.)(highest|current|top|winning)bid(rax|amount)?$/, /(^|\.)bid\.?(rax|amount|value)$/, /(^|\.)bid$/, /(^|\.)price$/],
  bidder: [/bidder\.?(user)?name$/, /bidder\.?handle$/, /(^|\.)highestbidder(username|name)?$/, /(^|\.)(buyer|bidder)\.?username$/],
  bidderId: [/bidder\.?(user)?id$/, /(^|\.)bidderuserid$/, /(^|\.)highestbidder\.?id$/],
  auctionId: [/(^|\.)auctionid$/, /(^|\.)listingid$/, /(^|\.)id$/],
  timestamp: [/(^|\.)(bidat|bidtime|updatedat|timestamp|createdat)$/],
  expiresAt: [/(^|\.)(expiresat|endsat|endtime|endat|expirationtime)$/],
  status: [/(^|\.)(auction)?status$/, /(^|\.)state$/],
};

export function guessMapping(rows: Row[]): Mapping {
  if (!rows.length) return {};
  const paths = new Set<string>();
  for (const r of rows.slice(0, 20)) for (const p of Object.keys(flatten(r))) paths.add(p);
  const list = [...paths];
  const m: Mapping = {};
  for (const f of Object.keys(GUESS) as Field[]) {
    for (const rx of GUESS[f]) {
      const hit = list.filter((p) => rx.test(p.toLowerCase())).sort((a, b) => a.length - b.length)[0];
      if (hit) {
        m[f] = { path: hit };
        break;
      }
    }
  }
  return m;
}

const SPORT_ALIAS: Record<string, Sport> = { NCAAF: 'CFB', NCAAM: 'CBB', NCAAB: 'CBB', GOLF: 'PGA', COLLEGEFOOTBALL: 'CFB', COLLEGEBASKETBALL: 'CBB', MMA: 'UFC' };

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, '')));
const asIso = (v: unknown, fallback: number): string => {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? new Date(fallback).toISOString() : new Date(t).toISOString();
};

export interface Applied {
  bids: AuctionBid[];
  skipped: Array<{ row: number; reason: string }>;
}

export function applyMapping(rows: Row[], mapping: Mapping, now = Date.now()): Applied {
  const bids: AuctionBid[] = [];
  const skipped: Applied['skipped'] = [];
  const read = (r: Row, f: Field): unknown => {
    const s = mapping[f];
    if (!s) return undefined;
    return 'value' in s ? s.value : getPath(r, s.path);
  };
  rows.forEach((r, i) => {
    const n = i + 1;
    const player = String(read(r, 'playerName') ?? '').trim();
    const sportRaw = String(read(r, 'sport') ?? '').trim().toUpperCase().replace(/[\s_-]/g, '');
    const sport = (SPORT_ALIAS[sportRaw] ?? sportRaw) as Sport;
    const rarityRaw = String(read(r, 'rarity') ?? '').trim().toLowerCase();
    const rarity = RARITIES.find((x) => x.toLowerCase() === rarityRaw) as Rarity | undefined;
    const rating = num(read(r, 'rating'));
    const bid = num(read(r, 'bid'));
    const bidder = String(read(r, 'bidder') ?? '').trim();
    if (!player) return void skipped.push({ row: n, reason: 'no player name' });
    if (!SPORTS.includes(sport)) return void skipped.push({ row: n, reason: `unknown sport "${sportRaw}"` });
    if (!rarity) return void skipped.push({ row: n, reason: `unknown rarity "${rarityRaw}"` });
    if (!(rating > 0)) return void skipped.push({ row: n, reason: 'rating is not a positive number' });
    if (!(bid > 0)) return void skipped.push({ row: n, reason: 'bid is not a positive number' });
    if (!bidder) return void skipped.push({ row: n, reason: 'no bidder' });
    const ts = asIso(read(r, 'timestamp'), now);
    const exp = read(r, 'expiresAt');
    const expIso = exp == null ? ts : asIso(exp, now);
    const statusRaw = String(read(r, 'status') ?? '').toLowerCase();
    const closed = /clos|end|sold|complete|won|expired/.test(statusRaw) || (exp != null && Date.parse(expIso) <= now);
    bids.push({
      auctionId: String(read(r, 'auctionId') ?? `imp-${n}`),
      cardId: `${sport}:${player}:${rarity}`,
      playerName: player,
      sport,
      rarity,
      cardRating: rating,
      highestBidRax: bid,
      perRatingPrice: perRatingPrice(bid, rating),
      bidderUsername: bidder,
      bidderUserId: String(read(r, 'bidderId') ?? bidder),
      timestamp: ts,
      expiresAt: expIso,
      status: closed ? 'closed' : 'active',
    });
  });
  return { bids, skipped };
}

/** Parse pasted text (JSON, or JSON copied with a "response:" prefix / trailing junk) into rows. */
export function parsePasted(text: string): { rows: Row[]; path: string } | { error: string } {
  const t = text.trim();
  if (!t) return { error: 'Paste a JSON response first.' };
  const start = t.search(/[[{]/);
  if (start < 0) return { error: 'That does not look like JSON.' };
  let json: unknown;
  try {
    json = JSON.parse(t.slice(start));
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
  const found = findRows(json);
  return found.rows.length ? found : { error: 'No list of records found in that JSON.' };
}
