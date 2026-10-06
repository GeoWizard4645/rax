import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as real, ttlFor, validEndpoint } from '../../functions/api/proxy/real';
import { onRequest as cdn, hostAllowed, safeFilename } from '../../functions/api/proxy/cdn';
import { onRequest as auctions, deriveContenders, normalizeAuction } from '../../functions/api/scout/auctions';
import { onRequest as spikes } from '../../functions/api/market/spikes';
import { bidsToHourly, recordSnapshot, rollup } from '../../functions/_lib/history';
import type { AuctionBid, SeriesPoint } from '../../src/types/market';
const J = (r: Response): Promise<any> => r.json() as Promise<any>;

const run = (fn: any, url: string, env: any = {}) => fn({ request: new Request(`https://rax.test${url}`), env, waitUntil: () => {} }) as Promise<Response>;
afterEach(() => vi.unstubAllGlobals());
const stub = (h: (u: string, i?: RequestInit) => Response) => { const s = vi.fn(async (u: any, i?: RequestInit) => h(String(u), i)); vi.stubGlobal('fetch', s); return s; };

describe('/api/proxy/real', () => {
  it('validates endpoints', () => {
    expect(validEndpoint('v1/users/example/profile')).toBe(true);
    for (const bad of ['', 'v2/x', 'v1/../admin', 'v1//x', 'http://evil', 'v1/a b', 'users/x']) expect(validEndpoint(bad)).toBe(false);
  });
  it('60s TTL for live games, 300s otherwise', () => {
    expect(ttlFor('v1/games/live')).toBe(60);
    expect(ttlFor('v1/users/x/profile')).toBe(300);
  });
  it('503s with guidance when no upstream is configured (UI falls back to sample)', async () => {
    const r = await run(real, '/api/proxy/real?endpoint=v1/users/x/profile');
    expect(r.status).toBe(503);
    expect((await J(r)).error).toBe('upstream_not_configured');
  });
  it('sends an honest User-Agent, JSON accept and CORS', async () => {
    const s = stub(() => new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } }));
    const r = await run(real, '/api/proxy/real?endpoint=v1/users/x/profile&a=1', { REAL_API_BASE: 'https://api.example.test/' });
    expect(await J(r)).toEqual({ ok: 1 });
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const [url, init] = s.mock.calls[0];
    expect(url).toBe('https://api.example.test/v1/users/x/profile?a=1');
    expect((init as any).headers['User-Agent']).toMatch(/^rax-super-suite/);
    expect((init as any).headers.Accept).toBe('application/json');
  });
  it('rejects http bases, non-GET and traversal', async () => {
    expect((await run(real, '/api/proxy/real?endpoint=v1/x', { REAL_API_BASE: 'http://insecure.test' })).status).toBe(503);
    expect((await run(real, '/api/proxy/real?endpoint=v1/../x', { REAL_API_BASE: 'https://a.test' })).status).toBe(400);
    expect((await real({ request: new Request('https://rax.test/api/proxy/real?endpoint=v1/x', { method: 'POST' }), env: {}, waitUntil() {} } as any)).status).toBe(405);
  });
  it('maps upstream failures', async () => {
    stub(() => new Response('nope', { status: 500 }));
    expect((await run(real, '/api/proxy/real?endpoint=v1/x', { REAL_API_BASE: 'https://a.test' })).status).toBe(502);
    stub(() => new Response('<html>', { status: 200 }));
    expect((await run(real, '/api/proxy/real?endpoint=v1/y', { REAL_API_BASE: 'https://a.test' })).status).toBe(502);
  });
});

describe('/api/proxy/cdn', () => {
  const env = { CDN_ALLOWED_HOSTS: 'cdn.example.test, *.img.example.test' };
  const png = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  it('host allowlist supports wildcards but not look-alikes', () => {
    expect(hostAllowed('cdn.example.test', env.CDN_ALLOWED_HOSTS)).toBe(true);
    expect(hostAllowed('a.img.example.test', env.CDN_ALLOWED_HOSTS)).toBe(true);
    expect(hostAllowed('img.example.test', env.CDN_ALLOWED_HOSTS)).toBe(false);
    expect(hostAllowed('evilcdn.example.test', env.CDN_ALLOWED_HOSTS)).toBe(false);
    expect(hostAllowed('cdn.example.test.evil.com', env.CDN_ALLOWED_HOSTS)).toBe(false);
    expect(hostAllowed('x', undefined)).toBe(false);
  });
  it('is closed until configured', async () => {
    expect((await run(cdn, '/api/proxy/cdn?url=https://cdn.example.test/a.png')).status).toBe(503);
  });
  it('serves allowed images, with attachment disposition on download', async () => {
    stub(png);
    const r = await run(cdn, '/api/proxy/cdn?url=https://cdn.example.test/p/cut%20out.png&download=1', env);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="cut_out.png"');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('blocks disallowed hosts, http, credentials and non-images', async () => {
    const s = stub(png);
    expect((await run(cdn, '/api/proxy/cdn?url=https://evil.test/a.png', env)).status).toBe(403);
    expect((await run(cdn, '/api/proxy/cdn?url=http://cdn.example.test/a.png', env)).status).toBe(400);
    expect((await run(cdn, '/api/proxy/cdn?url=https://u:p@cdn.example.test/a.png', env)).status).toBe(400);
    expect((await run(cdn, '/api/proxy/cdn?url=http%3A%2F%2F169.254.169.254%2F', env)).status).toBe(400);
    expect(s).not.toHaveBeenCalled();
    stub(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await run(cdn, '/api/proxy/cdn?url=https://cdn.example.test/x', env)).status).toBe(415);
  });
  it('re-validates redirects (no hop to an unlisted host)', async () => {
    stub((u) => (u.includes('cdn.example.test') ? new Response(null, { status: 302, headers: { location: 'https://internal.evil/x.png' } }) : png()));
    expect((await run(cdn, '/api/proxy/cdn?url=https://cdn.example.test/a.png', env)).status).toBe(403);
  });
  it('rejects oversized images', async () => {
    stub(() => new Response(new Uint8Array(4), { headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) } }));
    expect((await run(cdn, '/api/proxy/cdn?url=https://cdn.example.test/big.png', env)).status).toBe(413);
  });
  it('sanitises filenames', () => {
    expect(safeFilename('../../etc/passwd', 'x')).toBe('passwd');
    expect(safeFilename('a b%20c.png', 'x')).toBe('a_b_c.png');
    expect(safeFilename('..', 'fb')).toBe('fb');
    expect(safeFilename(null, 'fallback.png')).toBe('fallback.png');
  });
});

describe('/api/scout/auctions', () => {
  it('serves labelled sample data when nothing is configured', async () => {
    const r = await run(auctions, '/api/scout/auctions?sport=NFL&limit=10');
    const b = await J(r);
    expect(b.source).toBe('sample');
    expect(b.note).toMatch(/not configured/);
    expect(b.bids.length).toBeLessThanOrEqual(10);
    expect(b.bids.every((x: AuctionBid) => x.sport === 'NFL')).toBe(true);
    expect(Object.keys(b.baselines).length).toBeGreaterThan(50);
  });
  it('rejects unknown sports', async () => {
    expect((await run(auctions, '/api/scout/auctions?sport=FC')).status).toBe(400);
  });
  it('goes live when configured, normalising per-rating price', async () => {
    const now = Date.now();
    const feed = Array.from({ length: 6 }, (_, i) => ({
      auctionId: `a${i}`, cardId: `c${i}`, playerName: 'Josh Allen', sport: 'nfl', rarity: 'mystic', cardRating: 96,
      highestBidRax: 2400 + i * 100, bidderUsername: i % 2 ? 'x' : 'y', bidderUserId: `u${i}`,
      timestamp: new Date(now - i * 60_000).toISOString(), expiresAt: new Date(now + 3600_000).toISOString(),
    }));
    const s = stub(() => new Response(JSON.stringify({ auctions: feed }), { headers: { 'content-type': 'application/json' } }));
    const r = await run(auctions, '/api/scout/auctions?limit=999', { REAL_API_BASE: 'https://api.test', AUCTIONS_ENDPOINT: 'v1/auctions' });
    const b = await J(r);
    expect(s.mock.calls[0][0]).toBe('https://api.test/v1/auctions');
    expect(b.source).toBe('live');
    expect(b.bids[0].perRatingPrice).toBeCloseTo(2400 / 96);
    expect(b.bids[0].status).toBe('active');
    expect(b.contenders.length).toBeGreaterThan(0);
  });
  it('falls back to sample if the live feed fails', async () => {
    stub(() => new Response('x', { status: 500 }));
    const b = await J(await run(auctions, '/api/scout/auctions?limit=7', { REAL_API_BASE: 'https://api.test', AUCTIONS_ENDPOINT: 'v1/auctions' }));
    expect(b.source).toBe('sample');
    expect(b.note).toMatch(/unavailable/);
  });
  it('normaliser rejects incomplete rows and accepts aliases', () => {
    expect(normalizeAuction({ playerName: 'A' })).toBeNull();
    expect(normalizeAuction(null)).toBeNull();
    const ok = normalizeAuction({ id: 'z', player: { name: 'A B' }, sport: 'NBA', rarity: 'EPIC', rating: 80, currentBid: 400, highestBidder: { username: 'q', id: '9' } })!;
    expect(ok).toMatchObject({ auctionId: 'z', playerName: 'A B', sport: 'NBA', rarity: 'Epic', perRatingPrice: 5, bidderUserId: '9' });
  });
  it('derives contenders only from Mystic/Legendary repeat bidders', () => {
    const now = Date.now();
    const mk = (u: string, rarity: any, i: number): AuctionBid => ({ auctionId: `${u}${i}`, cardId: 'c', playerName: 'P', sport: 'NFL', rarity, cardRating: 90, highestBidRax: 900, perRatingPrice: 10, bidderUsername: u, bidderUserId: u, timestamp: new Date(now - i * 1000).toISOString(), expiresAt: new Date(now).toISOString(), status: i ? 'closed' : 'active' });
    const c = deriveContenders([mk('a', 'Mystic', 0), mk('a', 'Mystic', 1), mk('b', 'Common', 0), mk('b', 'Common', 1), mk('c', 'Mystic', 0)], now);
    expect(c.map((x) => x.bidderUsername)).toEqual(['a']);
    expect(c[0]).toMatchObject({ bids7d: 2, buys7d: 1 });
  });
});

describe('/api/market/spikes', () => {
  it('serves spikes + fair value from sample data', async () => {
    const b = await J(await run(spikes, '/api/market/spikes?sport=NFL'));
    expect(b.source).toBe('sample');
    expect(b.players.every((p: any) => p.sport === 'NFL')).toBe(true);
    expect(b.model.n).toBeGreaterThan(5);
    expect(b.spikes.every((s: any) => s.z > 2)).toBe(true);
  });
  it('serves candles per window and 404s unknown players', async () => {
    const all = await J(await run(spikes, '/api/market/spikes'));
    const key = all.players[0].key;
    for (const w of ['24h', '7d', '30d']) {
      const c = await J(await run(spikes, `/api/market/spikes?candles=${encodeURIComponent(key)}&window=${w}`));
      expect(c.candles.length).toBeGreaterThan(10);
    }
    expect((await run(spikes, '/api/market/spikes?candles=NFL:nobody')).status).toBe(404);
    expect((await run(spikes, `/api/market/spikes?candles=${key}&window=1y`)).status).toBe(400);
  });
});

describe('history (KV rollup)', () => {
  const HOUR = 3_600_000;
  const mkBid = (i: number, hoursAgo: number, now: number): AuctionBid => ({
    auctionId: `a${i}`, cardId: 'c', playerName: 'Josh Allen', sport: 'NFL', rarity: 'Epic', cardRating: 90, highestBidRax: 900 + i, perRatingPrice: (900 + i) / 90,
    bidderUsername: 'q', bidderUserId: 'q', timestamp: new Date(now - hoursAgo * HOUR).toISOString(), expiresAt: new Date(now).toISOString(), status: 'active',
  });
  it('is idempotent: re-ingesting the same feed does not inflate volume', async () => {
    const now = Date.UTC(2026, 9, 5, 12, 30);
    const bids = [mkBid(1, 0.1, now), mkBid(2, 0.2, now), mkBid(3, 2, now)];
    let doc = await recordSnapshot({}, bids, now, null);
    doc = await recordSnapshot({}, bids, now + 60_000, doc);
    doc = await recordSnapshot({}, bids, now + 120_000, doc);
    const pts = doc.players['nfl:josh-allen'] ?? doc.players['NFL:josh-allen'];
    expect(pts.points.reduce((a, p) => a + p.volume, 0)).toBe(3);
  });
  it('throttles KV writes to once per 10 minutes', async () => {
    const put = vi.fn();
    const env: any = { CACHE: { put } };
    const now = Date.UTC(2026, 9, 5, 12);
    let doc = await recordSnapshot(env, [mkBid(1, 0, now)], now, null);
    doc = await recordSnapshot(env, [mkBid(1, 0, now)], now + 60_000, doc);
    expect(put).toHaveBeenCalledTimes(1);
    await recordSnapshot(env, [mkBid(1, 0, now)], now + 11 * 60_000, doc);
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('rolls hourly points older than 7 days into daily and drops >30 days', () => {
    const now = Date.UTC(2026, 9, 5, 12);
    const pts: SeriesPoint[] = [];
    for (let h = 40 * 24; h >= 0; h--) pts.push({ t: now - h * HOUR, volume: 1, avgBid: 100, medPrp: 1, open: 1, high: 2, low: 0.5, close: 1.5 });
    const r = rollup(pts, now);
    expect(r.filter((p) => p.t > now - 7 * 24 * HOUR)).toHaveLength(7 * 24);
    expect(r.every((p) => p.t > now - 30 * 24 * HOUR)).toBe(true);
    expect(r.length).toBeLessThan(7 * 24 + 25);
    expect(r.reduce((a, p) => a + p.volume, 0)).toBeLessThanOrEqual(30 * 24 + 1);
  });
  it('groups bids into player-hours', () => {
    const now = Date.UTC(2026, 9, 5, 12, 30);
    const m = bidsToHourly([mkBid(1, 0.1, now), mkBid(2, 0.2, now), mkBid(3, 5, now)]);
    const p = [...m.values()][0].points;
    expect(p.size).toBe(2);
  });
});
