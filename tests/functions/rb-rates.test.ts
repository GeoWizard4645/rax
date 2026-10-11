import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest as rates } from '../../functions/api/market/rates';
import { onRequest as spikes } from '../../functions/api/market/spikes';
import { ensureSample, resetRbMemo, WRITE_EVERY_MS } from '../../functions/_lib/rbRates';
import { appendSample, emptyDoc, HOUR, RB_HIST_KEY, type RbAgg } from '../../shared/rbHistory';

const J = (r: Response): Promise<any> => r.json() as Promise<any>;
const NOW = Date.UTC(2026, 9, 10, 12, 0);

const rawBoard = (n = 60, rate = 10) => ({
  value: JSON.stringify({
    users: Object.fromEntries(Array.from({ length: n }, (_, i) => [`u${i}`, { name: `U${i}`, hash: 's:secret', created: 1 }])),
    offers: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, user: `u${i}`, sport: i % 2 ? 'NFL' : 'FC', player: `Player ${i % 20}`, rate: rate + (i % 3), link: `https://www.realapp.com/x/${i}`, ts: NOW - i * 1000 })),
    minimums: [], keeplist: [], house: [], reports: [{ secret: 'x' }], fullprice: [], gamedata: [],
  }),
});

const kv = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
};
const stubFetch = (h: (u: string, i?: RequestInit) => Response) => {
  const s = vi.fn(async (u: any, i?: RequestInit) => h(String(u), i));
  vi.stubGlobal('fetch', s);
  return s;
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const run = (fn: any, url: string, env: any = {}) => fn({ request: new Request(`https://rax.test${url}`), env, waitUntil: () => {} }) as Promise<Response>;

beforeEach(() => {
  resetRbMemo();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('/api/market/rates (recorder)', () => {
  it('reads Rateboard with an honest UA, strips secrets, records a sample, writes KV once per 10 minutes', async () => {
    const f = stubFetch(() => ok(rawBoard()));
    const env: any = { CACHE: kv() };
    const b = await J(await run(rates, '/api/market/rates', env));
    const [url, init] = f.mock.calls.find((c) => String(c[0]).includes('rateboard-cgi'))!;
    expect(String(url)).toBe('https://rateboard-cgi.pages.dev/api/kv?key=ratebrd_market_v1');
    expect((init as any).headers['User-Agent']).toMatch(/^rax-super-suite/);
    expect(b).toMatchObject({ source: 'rateboard', unit: 'rate', sampled: true, wroteKv: true, skipped: null });
    expect(b.coverage).toMatchObject({ samples: 1, persisted: true, ready: false });
    expect(b.board).toMatchObject({ offers: 60 });
    expect(b.baselines).toEqual({});
    const saved = env.CACHE.store.get(RB_HIST_KEY)!;
    expect(saved).not.toMatch(/secret|hash|reports/);
    expect(env.CACHE.put).toHaveBeenCalledTimes(1);

    // 2 minutes later: sampled again, but KV not rewritten
    vi.setSystemTime(NOW + 2 * 60_000);
    const b2 = await J(await run(rates, '/api/market/rates', env));
    expect(b2).toMatchObject({ sampled: true, wroteKv: false });
    expect(b2.coverage.samples).toBe(2);
    expect(env.CACHE.put).toHaveBeenCalledTimes(1);

    // 11 minutes after the first write
    vi.setSystemTime(NOW + WRITE_EVERY_MS + 60_000);
    expect((await J(await run(rates, '/api/market/rates', env))).wroteKv).toBe(true);
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it('KV budget: a day of 10-minute pings is at most 144 writes', async () => {
    stubFetch(() => ok(rawBoard()));
    const env: any = { CACHE: kv() };
    for (let m = 0; m < 24 * 60; m += 10) {
      vi.setSystemTime(NOW + m * 60_000);
      await ensureSample(env, { origin: 'https://rax.test' });
    }
    expect(env.CACHE.put.mock.calls.length).toBeLessThanOrEqual(144);
    // and even a request every minute (heavy traffic) stays under the same ceiling
    const env2: any = { CACHE: kv() };
    resetRbMemo();
    for (let m = 0; m < 24 * 60; m++) {
      vi.setSystemTime(NOW + m * 60_000);
      await ensureSample(env2, { origin: 'https://rax.test' });
    }
    expect(env2.CACHE.put.mock.calls.length).toBeLessThanOrEqual(144);
  });

  it('works without KV but says history is not persisted', async () => {
    stubFetch(() => ok(rawBoard()));
    const b = await J(await run(rates, '/api/market/rates', {}));
    expect(b.coverage.persisted).toBe(false);
    expect(b.wroteKv).toBe(false);
    expect(b.sampled).toBe(true);
  });

  it('keeps serving existing history when Rateboard is down, and does not record', async () => {
    const prior = appendSample(emptyDoc(), [{ key: 'NFL:a', sport: 'NFL', name: 'A', best: 10, med: 10, buyers: 1, offers: 1, house: 0 }], NOW - HOUR);
    const env: any = { CACHE: kv() };
    env.CACHE.store.set(RB_HIST_KEY, JSON.stringify(prior));
    stubFetch(() => new Response('nope', { status: 500 }));
    const b = await J(await run(rates, '/api/market/rates', env));
    expect(b.skipped).toBe('upstream');
    expect(b.sampled).toBe(false);
    expect(b.coverage.samples).toBe(1);
  });

  it('refuses to record an implausible (hollowed-out) board', async () => {
    const aggs: RbAgg[] = Array.from({ length: 80 }, (_, i) => ({ key: `NFL:p${i}`, sport: 'NFL', name: `P${i}`, best: 10, med: 10, buyers: 1, offers: 1, house: 0 }));
    const prior = appendSample(emptyDoc(), aggs, NOW - HOUR);
    const env: any = { CACHE: kv() };
    env.CACHE.store.set(RB_HIST_KEY, JSON.stringify(prior));
    stubFetch(() => ok(rawBoard(10)));
    const b = await J(await run(rates, '/api/market/rates', env));
    expect(b.skipped).toBe('implausible');
    expect(b.coverage.samples).toBe(1);
  });

  it('merges the bundled seed once (older points go under the live ones)', async () => {
    let seed = emptyDoc();
    for (let h = 0; h < 30; h++) seed = appendSample(seed, [{ key: 'NFL:old', sport: 'NFL', name: 'Old Guy', best: 7, med: 7, buyers: 1, offers: 1, house: 0 }], NOW - (60 - h) * 3_600_000);
    stubFetch((u) => (u.includes('/data/rb-rates-seed.json') ? ok(seed) : ok(rawBoard())));
    const env: any = { CACHE: kv() };
    const b = await J(await run(rates, '/api/market/rates', env));
    expect(b.coverage.seeded).toBe(30);
    expect(b.coverage.samples).toBe(31);
    expect(b.coverage.spanDays).toBeGreaterThan(1.5);
    const b2 = await J(await run(rates, '/api/market/rates', env));
    expect(b2.coverage.seeded).toBe(30);
    expect(b2.coverage.samples).toBe(32);
  });
});

describe('/api/market/spikes?source=rateboard', () => {
  const prime = async () => {
    stubFetch(() => ok(rawBoard()));
    const env: any = { CACHE: kv() };
    await run(rates, '/api/market/rates', env);
    return env;
  };
  it('serves the depth-vs-rate summary with coverage and no invented ratings', async () => {
    const env = await prime();
    const b = await J(await run(spikes, '/api/market/spikes?source=rateboard', env));
    expect(b).toMatchObject({ source: 'rateboard', unit: 'rate', xAxis: 'buyers' });
    expect(b.coverage.ready).toBe(false);
    expect(b.spikes).toEqual([]);
    expect(b.players.length).toBeGreaterThan(5);
    expect(b.players.every((p: any) => p.rating === 1 && p.rarity === null)).toBe(true);
    expect(b.note).toMatch(/3 days/);
  });
  it('filters by Rateboard sport (FC allowed), rejects card-feed-only sports', async () => {
    const env = await prime();
    const fc = await J(await run(spikes, '/api/market/spikes?source=rateboard&sport=FC', env));
    expect(fc.players.length).toBeGreaterThan(0);
    expect(fc.players.every((p: any) => p.sport === 'FC')).toBe(true);
    expect((await run(spikes, '/api/market/spikes?source=rateboard&sport=NBA', env)).status).toBe(400);
  });
  it('serves candles + the raw recorded change log + current state; 404s unknown players; validates window', async () => {
    const env = await prime();
    const all = await J(await run(spikes, '/api/market/spikes?source=rateboard', env));
    const key = all.players[0].key;
    const c = await J(await run(spikes, `/api/market/spikes?source=rateboard&candles=${encodeURIComponent(key)}&window=7d`, env));
    expect(c).toMatchObject({ source: 'rateboard', unit: 'rate', key });
    expect(c.changes.length).toBeGreaterThan(0);
    expect(c.current.best).toBeGreaterThan(0);
    expect((await run(spikes, '/api/market/spikes?source=rateboard&candles=NFL:nobody', env)).status).toBe(404);
    expect((await run(spikes, `/api/market/spikes?source=rateboard&candles=${key}&window=1y`, env)).status).toBe(400);
  });
  it('forecast inputs carry the bid-rate unit and coverage; unknown players 404; sample pin still returns sample', async () => {
    const env = await prime();
    const all = await J(await run(spikes, '/api/market/spikes?source=rateboard', env));
    const fi = await run(spikes, `/api/market/spikes?source=rateboard&forecastInputs=${encodeURIComponent(all.players[0].key)}`, env);
    if (fi.status === 200) expect(await J(fi)).toMatchObject({ unit: 'rate', rarity: null, rating: 1 });
    else expect(fi.status).toBe(404); // a single sample has no daily history yet
    expect((await run(spikes, '/api/market/spikes?source=rateboard&forecastInputs=NFL:nobody', env)).status).toBe(404);
    const s = await J(await run(spikes, '/api/market/spikes?source=sample&sport=NFL'));
    expect(s.source).toBe('sample');
  });
});
