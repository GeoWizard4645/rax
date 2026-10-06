import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMarquee, normalizeEspn, espnDate } from '../../shared/schedule';
import { onRequest } from '../../functions/api/intel/schedule';

const J = (r: Response): Promise<any> => r.json() as Promise<any>;
const ev = (over: any = {}) => ({
  id: '1', date: '2026-10-06T00:15Z', season: { type: 2 }, status: { type: { state: 'pre' } },
  competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'New Orleans Saints' } }, { homeAway: 'away', team: { displayName: 'Atlanta Falcons' } }], broadcasts: [{ market: 'national', names: ['ESPN'] }], ...over }],
});

describe('ESPN normalizer', () => {
  it('maps teams, broadcaster, status and flags estimates', () => {
    const [g] = normalizeEspn('NFL', { events: [ev()] });
    expect(g).toMatchObject({ id: 'espn-NFL-1', home: 'New Orleans Saints', away: 'Atlanta Falcons', broadcast: 'ESPN', status: 'scheduled', estimated: true });
    expect(g.startsAt).toBe('2026-10-06T00:15:00.000Z');
  });
  it('NFL Monday-night (ET) is marquee; Sunday 1pm ET is not; Sunday night is', () => {
    expect(isMarquee('NFL', '2026-10-06T00:15Z', [], 2)).toBe(true); // Mon Oct 5, 8:15pm ET
    expect(isMarquee('NFL', '2026-10-11T17:00Z', [], 2)).toBe(false); // Sun 1pm ET
    expect(isMarquee('NFL', '2026-10-12T00:20Z', [], 2)).toBe(true); // Sun 8:20pm ET
    expect(isMarquee('NFL', '2026-10-09T00:15Z', [], 2)).toBe(true); // Thu Oct 8, 8:15pm ET
    expect(isMarquee('NFL', '2026-10-08T00:15Z', [], 2)).toBe(false); // Wed Oct 7
  });
  it('postseason and primetime national networks are marquee for other sports', () => {
    expect(isMarquee('NBA', '2026-10-06T00:00Z', ['ESPN'], 2)).toBe(true);
    expect(isMarquee('NHL', '2026-10-06T00:00Z', ['NHL Net'], 2)).toBe(false);
    expect(isMarquee('MLB', '2026-10-06T00:00Z', [], 3)).toBe(true);
  });
  it('scales pace by the betting total when ESPN has one, within bounds', () => {
    const hi = normalizeEspn('NBA', { events: [ev({ odds: [{ overUnder: 260 }] })] })[0];
    const base = normalizeEspn('NBA', { events: [ev()] })[0];
    expect(base.pace).toBe(1.15);
    expect(hi.pace).toBeGreaterThan(base.pace);
    expect(hi.pace).toBeLessThanOrEqual(1.15 * 1.25 + 1e-9);
  });
  it('maps live/final and skips unreadable events without throwing', () => {
    const out = normalizeEspn('NHL', { events: [{ ...ev(), status: { type: { state: 'in' } } }, { ...ev(), id: '2', status: { type: { state: 'post' } } }, { id: '3' }, null] as any });
    expect(out.map((g) => g.status)).toEqual(['live', 'final']);
    expect(normalizeEspn('NFL', null)).toEqual([]);
    expect(normalizeEspn('NFL', { events: 'nope' })).toEqual([]);
  });
  it('formats ESPN dates in US Eastern', () => {
    expect(espnDate(Date.UTC(2026, 9, 6, 3, 0), 0)).toBe('20261005'); // 11pm ET Oct 5
    expect(espnDate(Date.UTC(2026, 9, 6, 15, 0), 1)).toBe('20261007');
  });
});

describe('/api/intel/schedule', () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = () => (onRequest as any)({ request: new Request('https://rax.test/api/intel/schedule?days=1'), env: {}, waitUntil() {} }) as Promise<Response>;

  it('returns live games, drops finals, and sorts by start', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any) => {
      calls.push(String(u));
      const body = String(u).includes('football/nfl')
        ? { events: [ev({ id: 'late', date: '2026-10-07T00:00Z' }).id && { ...ev(), id: 'late', date: '2026-10-08T00:00Z' }, { ...ev(), id: 'early', date: '2026-10-06T00:00Z' }, { ...ev(), id: 'done', status: { type: { state: 'post' } } }] }
        : { events: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }));
    const b = await J(await run());
    expect(b.source).toBe('live');
    expect(b.games.map((g: any) => g.id)).toEqual(['espn-NFL-early', 'espn-NFL-late']);
    expect(calls).toHaveLength(6); // one scoreboard per sport for 1 day
    expect(calls.every((u) => u.startsWith('https://site.api.espn.com/apis/site/v2/sports/'))).toBe(true);
  });

  it('falls back to labelled sample matchups if ESPN is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    const b = await J(await run());
    expect(b.source).toBe('sample');
    expect(b.games.length).toBeGreaterThan(3);
    expect(b.note).toMatch(/unavailable/);
  });
});
