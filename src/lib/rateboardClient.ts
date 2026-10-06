/**
 * Client for Rateboard through /api/proxy/rateboard. Every function here results in a real request
 * to rateboard-cgi.pages.dev — Rateboard stays the source of truth for accounts, offers and collections.
 */
import { getJson, messageOf, postJson } from './api';
import { hashPassword, RB_BOARD_KEY, sanitizeBoard, type RbBoard, type RbOffer, type RbSport } from '../../shared/rateboard';
import type { CollectionPlayer } from '../types/real';

const P = '/api/proxy/rateboard';
const q = (path: string, params: Record<string, string> = {}) => `${P}?${new URLSearchParams({ path, ...params }).toString()}`;

export async function fetchBoard(fresh = false, signal?: AbortSignal): Promise<RbBoard> {
  const d = await getJson<{ board: RbBoard }>(q('api/kv', { key: RB_BOARD_KEY, ...(fresh ? { fresh: '1' } : {}) }), signal);
  return sanitizeBoard({ value: JSON.stringify(d.board) });
}

export interface PlayerHit {
  name: string;
  team: string;
}
export async function searchPlayers(sport: RbSport, query: string, signal?: AbortSignal): Promise<{ players: PlayerHit[]; building?: boolean }> {
  return getJson(q('api/players', { sport, q: query }), signal);
}

export type LoginStatus = 'ok' | 'new' | 'wrong' | 'banned' | 'reset';
export interface LoginResult {
  status: LoginStatus;
  key: string;
  name: string;
  hash: string;
}

/** Hash in the browser, then ask the edge to verify against Rateboard's record. The password itself is never sent. */
export async function checkLogin(username: string, password: string): Promise<LoginResult> {
  const hash = await hashPassword(password);
  const r = await postJson<{ status: LoginStatus; key: string; name: string }>(q('_login'), { username, hash });
  return { ...r, hash };
}

export type WriteResult = { ok: true } | { ok: false; message: string };

async function write(body: unknown): Promise<WriteResult> {
  try {
    const res = await fetch(q('api/kv'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = messageOf(data, 'Could not save. Try again.');
      return { ok: false, message: m === 'board unavailable, nothing was changed' ? "Couldn't reach the board — nothing was changed. Try again." : m };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not save — check your connection and try again.' };
  }
}

export const signup = (key: string, name: string, hash: string) => write({ op: 'signup', key, name, hash });
export const setPassword = (key: string, hash: string) => write({ op: 'setPass', key, hash });
export const addOffer = (offer: Pick<RbOffer, 'id' | 'user' | 'sport' | 'player' | 'rate' | 'link'>) => write({ op: 'addOffer', offer });
export const updateOffer = (id: string, user: string, rate: number, link: string) => write({ op: 'updateOffer', id, user, rate, link });
export const removeOffer = (id: string, user: string) => write({ op: 'removeOffer', id, user });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ------------------------- collection pull ------------------------- */

export interface PullProgress {
  chunk: number;
  /** Seconds remaining of Rateboard's load-spreading wait, when there is one. */
  waitSec?: number;
}

interface CollectionChunk {
  players?: CollectionPlayer[];
  hashId?: string;
  hasMore?: boolean;
  nextStart?: number;
  error?: string;
  detail?: string;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Pull my cards from Real" — same loop Rateboard runs: fetch chunk by chunk (carrying hashId), merge
 * per player, and — when the first chunk wasn't cached — wait a random 0–10 s first so a burst of users
 * doesn't hammer Real. Throws an Error whose message is Rateboard's own wording.
 */
export async function pullCollection(
  username: string,
  sport: RbSport,
  onProgress?: (p: PullProgress) => void,
  opts: { stagger?: boolean } = {},
): Promise<CollectionPlayer[]> {
  const merged = new Map<string, CollectionPlayer>();
  const mergeChunk = (players: CollectionPlayer[]) => {
    for (const p of players) {
      if (!p.name) continue;
      if (!merged.has(p.name)) merged.set(p.name, { name: p.name, total: 0, totalValue: 0 });
      const m = merged.get(p.name)!;
      m.total += p.total || 0;
      m.totalValue = Math.round((m.totalValue + (p.totalValue || 0)) * 10) / 10;
    }
  };

  let start = 0;
  let hashId: string | null = null;
  for (let chunk = 1; chunk <= 50; chunk++) {
    onProgress?.({ chunk });
    const url = q('api/collection', { username, sport, start: String(start), ...(hashId ? { hashId } : {}) });
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('Could not reach the server — check your connection and try again.');
    }
    const data = (await res.json().catch(() => ({}))) as CollectionChunk;
    if (!res.ok) {
      throw new Error((data.message || data.error || 'Could not load cards — try again.') + (data.detail ? ` (${data.detail})` : ''));
    }
    if (chunk === 1 && opts.stagger !== false && res.headers.get('x-upstream-cache') !== 'HIT') {
      const ms = Math.floor(Math.random() * 10000);
      for (let left = Math.ceil(ms / 1000); left > 0; left--) {
        onProgress?.({ chunk, waitSec: left });
        await sleep(Math.min(1000, ms));
      }
    }
    mergeChunk(data.players || []);
    hashId = data.hashId || hashId;
    if (!data.hasMore) break;
    start = data.nextStart ?? start;
  }
  return [...merged.values()];
}
