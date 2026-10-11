import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/odds/load';
import { onRequest } from '../../functions/api/odds/events';
import type { OddsResponse } from '../../shared/odds';
import { planFanout } from '../../shared/oddsSources';

const J = (r: Response): Promise<any> => r.json() as Promise<any>;
const NOW = new Date('2026-10-11T03:30:00Z');

interface Call { url: string; headers: Record<string, string> }
let calls: Call[] = [];

/** Route each upstream URL to a recorded fixture; unknown → empty-but-valid payload for that source. */
function route(url: string, overrides: Record<string, () => Response> = {}): Response {
  for (const [needle, f] of Object.entries(overrides)) if (url.includes(needle)) return f();
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('api.elections.kalshi.com')) {
    if (url.includes('series_ticker=KXNHLGAME&')) return ok(fixture('kalshi_nhl_game'));
    if (url.includes('series_ticker=KXNHLSPREAD&')) return ok(fixture('kalshi_nhl_spread'));
    if (url.includes('series_ticker=KXNHLTOTAL&')) return ok(fixture('kalshi_nhl_total'));
    return ok({ markets: [], cursor: '' });
  }
  if (url.includes('gamma-api.polymarket.com')) {
    if (url.includes('tag_id=899') && url.includes('sports_market_types=moneyline')) return ok(fixture('poly_nhl_moneyline'));
    if (url.includes('tag_id=899')) return ok(fixture('poly_nhl_props'));
    return ok([]);
  }
  if (url.includes('site.web.api.espn.com')) {
    if (url.includes('league=nhl') && url.endsWith('dates=20261011')) return ok(fixture('espn_header_nhl'));
    return ok({ sports: [{ leagues: [{ events: [] }] }] });
  }
  return new Response('nope', { status: 404 });
}

function stub(overrides: Record<string, () => Response> = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return route(url, overrides);
  }));
}
const run = (q = 'sport=NHL', method = 'GET') => (onRequest as any)({ request: new Request(`https://rax.test/api/odds/events?${q}`, { method }), env: {}, waitUntil() {} }) as Promise<Response>;

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/api/odds/events', () => {
  it('merges the three sources into matched events, with CORS and a source report', async () => {
    stub();
    const r = await run();
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const b = (await J(r)) as OddsResponse;
    expect(b.sport).toBe('NHL');
    expect(b.sources.map((s) => [s.source, s.ok]).sort()).toEqual([['espn-dk', true], ['kalshi', true], ['polymarket', true]]);
    expect(b.sources.every((s) => s.count > 0)).toBe(true);
    expect(b.events).toHaveLength(3); // + CAR@PHI, which only ESPN/DraftKings has in the fixtures
    const sea = b.events.find((e) => e.id === 'NHL|2026-10-11|washington-capitals|seattle-kraken')!;
    expect(new Set(sea.markets.map((m) => m.source))).toEqual(new Set(['espn-dk', 'kalshi', 'polymarket']));
    expect(b.events.map((e) => e.startsAt)).toEqual([...b.events.map((e) => e.startsAt)].sort());
    expect(b.meta).toMatchObject({ subrequests: 8, trimmed: 0 });
  });

  it('makes few subrequests (NHL: 8; ALL and FC stay under the free-tier cap of 50) and sets headers per source', async () => {
    stub();
    await run('sport=NHL');
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      if (c.url.includes('espn.com')) expect(c.headers['User-Agent']).toBeUndefined(); // ESPN's CDN 403s custom UAs
      else expect(c.headers['User-Agent']).toMatch(/^rax-super-suite\//);
    }
    stub();
    const all = await J(await run('sport=ALL'));
    expect(calls.length).toBeLessThanOrEqual(44);
    expect(all.meta.subrequests).toBe(calls.length);
    expect(all.meta.lite).toBe(true);
    stub();
    await run('sport=FC');
    expect(calls.length).toBeLessThanOrEqual(44);
  });

  it('a failing source is reported, never fatal (Kalshi 500 + Polymarket network error)', async () => {
    stub({
      'api.elections.kalshi.com': () => new Response('boom', { status: 500 }),
      'gamma-api.polymarket.com': () => {
        throw new Error('connect ECONNRESET');
      },
    });
    const r = await run();
    expect(r.status).toBe(200);
    const b = (await J(r)) as OddsResponse;
    const by = Object.fromEntries(b.sources.map((s) => [s.source, s]));
    expect(by.kalshi).toMatchObject({ ok: false, count: 0 });
    expect(by.kalshi.error).toMatch(/HTTP 500/);
    expect(by.polymarket.ok).toBe(false);
    expect(by.polymarket.error).toMatch(/ECONNRESET/);
    expect(by['espn-dk'].ok).toBe(true);
    expect(b.events.length).toBeGreaterThan(0); // DraftKings-only events survive
    expect(b.events.every((e) => e.markets.every((m) => m.source === 'espn-dk'))).toBe(true);
  });

  it('partial failure keeps the source ok but says how many calls failed', async () => {
    stub({ 'series_ticker=KXNHLTOTAL': () => new Response('slow down', { status: 429 }) });
    const b = (await J(await run())) as OddsResponse;
    const k = b.sources.find((s) => s.source === 'kalshi')!;
    expect(k.ok).toBe(true);
    expect(k.error).toMatch(/1 of 3 requests failed/);
    expect(k.count).toBeGreaterThan(0);
  });

  it('malformed upstream JSON is a failed source, not a crash', async () => {
    stub({ 'site.web.api.espn.com': () => new Response('<html>blocked</html>', { status: 200 }) });
    const b = (await J(await run())) as OddsResponse;
    const e = b.sources.find((s) => s.source === 'espn-dk')!;
    expect(e.ok).toBe(false);
    expect(b.events.length).toBeGreaterThan(0);
  });

  it('?markets=ml skips the exchanges\' spread/total feeds (fewer calls)', async () => {
    stub();
    const b = (await J(await run('sport=NHL&markets=ml'))) as OddsResponse;
    expect(calls).toHaveLength(5); // Kalshi game, Polymarket moneyline, 3 ESPN days
    expect(b.meta?.lite).toBe(true);
    expect(b.events.flatMap((e) => e.markets).filter((m) => m.source !== 'espn-dk').every((m) => m.type === 'moneyline')).toBe(true);
  });

  it('empty days are fine: no events, all sources ok', async () => {
    stub();
    const b = (await J(await run('sport=WNBA'))) as OddsResponse;
    expect(b.events).toEqual([]);
    expect(b.sources.every((s) => s.ok)).toBe(true);
  });

  it('defaults to ALL, accepts lower case, rejects unknown sports and other methods, answers preflight', async () => {
    stub();
    expect(((await J(await run(''))) as OddsResponse).sport).toBe('ALL');
    expect(((await J(await run('sport=nhl'))) as OddsResponse).sport).toBe('NHL');
    const bad = await run('sport=CURLING');
    expect(bad.status).toBe(400);
    expect((await J(bad)).error).toBe('bad_sport');
    expect((await run('sport=NHL', 'POST')).status).toBe(405);
    const pre = await run('sport=NHL', 'OPTIONS');
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toMatch(/GET/);
  });
});


describe('Kalshi snapshot fallback (Kalshi 429s Cloudflare IPs)', () => {
  const kalshiBlocked = { 'api.elections.kalshi.com': () => new Response('slow down', { status: 429 }) };
  const snapshot = (ageMin: number) => {
    const fx: Record<string, string> = { KXNHLGAME: 'kalshi_nhl_game', KXNHLSPREAD: 'kalshi_nhl_spread', KXNHLTOTAL: 'kalshi_nhl_total' };
    const jobs = planFanout('NHL', NOW.getTime(), 999).jobs.filter((j) => j.source === 'kalshi');
    return {
      generatedAt: new Date(NOW.getTime() - ageMin * 60_000).toISOString(),
      sport: 'NHL',
      payloads: jobs.map((j: any) => ({ id: j.id, spec: j.spec, json: fixture(fx[j.spec.series]) })),
    };
  };
  const ok = (b: unknown) => () => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('uses a fresh snapshot when every live Kalshi call fails, and says so', async () => {
    stub({ ...kalshiBlocked, 'raw.githubusercontent.com': ok(snapshot(8)) });
    const b = (await J(await run())) as OddsResponse;
    const k = b.sources.find((s) => s.source === 'kalshi')!;
    expect(k.ok).toBe(true);
    expect(k.count).toBeGreaterThan(0);
    expect(k.error).toMatch(/8-minute-old snapshot/);
    expect(b.events.some((e) => e.markets.some((m) => m.source === 'kalshi'))).toBe(true);
    expect(calls.filter((c) => c.url.includes('raw.githubusercontent.com'))).toHaveLength(1);
  });

  it('flags a 90-minute-old snapshot as STALE but still uses it', async () => {
    stub({ ...kalshiBlocked, 'raw.githubusercontent.com': ok(snapshot(90)) });
    const k = ((await J(await run())) as OddsResponse).sources.find((s) => s.source === 'kalshi')!;
    expect(k.ok).toBe(true);
    expect(k.error).toMatch(/90-minute-old snapshot — STALE/);
  });

  it('drops a snapshot older than 3 hours and reports Kalshi as failed', async () => {
    stub({ ...kalshiBlocked, 'raw.githubusercontent.com': ok(snapshot(240)) });
    const k = ((await J(await run())) as OddsResponse).sources.find((s) => s.source === 'kalshi')!;
    expect(k.ok).toBe(false);
    expect(k.error).toMatch(/429/);
  });

  it('does not touch the snapshot when live Kalshi works', async () => {
    stub();
    await run();
    expect(calls.some((c) => c.url.includes('raw.githubusercontent.com'))).toBe(false);
  });
});
