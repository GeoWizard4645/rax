import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../../shared/agent/calc';
import { runTool, TOOLS } from '../../shared/agent/tools';
import { toolCtx } from './kbFixture';

const call = async (name: string, args: unknown, ctx = toolCtx()) => {
  const r = await runTool(name, args, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.result as any;
};

describe('calculate', () => {
  it.each([
    ['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-3^2', -9], ['15% * 200', 30], ['10 % 3', 1], ['sqrt(16)+abs(-2)', 6],
    ['1,250 * 1.5', 1875], ['$100/4', 25], ['max(1,5,3)', 5], ['round(2.567, 1)', 2.6], ['2**10', 1024], ['pi', Math.PI],
  ])('%s = %s', (e, v) => expect(evaluate(e)).toBeCloseTo(v as number, 9));
  it.each(['1/0', '2+', 'foo(1)', 'x', 'import("fs")', '1 2', '(1', 'a'.repeat(500)])('rejects %s', (e) => expect(() => evaluate(e)).toThrow());
});

describe('request_feature', () => {
  it('drafts an email to the developer with a safe, fully-encoded mailto link', async () => {
    const r = await call('request_feature', { title: 'Parlay (EV) calculator!', details: 'Please add a 3-leg parlay EV calculator.\nLegs: 55%, 60% & 52% — "fair" probs.', tab: 'edge' });
    expect(r.email).toBe('rax@vivaanshahani.com');
    expect(r.subject).toBe('RAX feature request: Parlay (EV) calculator!');
    expect(r.body).toContain('3-leg parlay EV calculator. Legs: 55%, 60% & 52%');
    expect(r.body).toContain('Related tab: edge');
    expect(r.mailto).toMatch(/^mailto:rax@vivaanshahani\.com\?subject=[A-Za-z0-9%._~-]+&body=[A-Za-z0-9%._~-]+$/); // no raw ( ) ! ' * space or newline
    const u = new URL(r.mailto);
    expect(u.searchParams.get('subject')).toBe(r.subject);
    expect(u.searchParams.get('body')).toBe(r.body);
  });
  it('requires a title and details, caps their length, and stays out of the public MCP server', async () => {
    expect(await runTool('request_feature', { title: 'x' }, toolCtx())).toMatchObject({ ok: false });
    const long = await call('request_feature', { title: 't'.repeat(500), details: 'd'.repeat(5000) });
    expect(long.mailto.length).toBeLessThan(3500);
    const { MCP_TOOLS } = await import('../../shared/agent/tools');
    expect(MCP_TOOLS.some((t) => t.name === 'request_feature')).toBe(false);
    expect(TOOLS.find((t) => t.name === 'request_feature')!.chat).toBe(true);
  });
});

describe('tool registry', () => {
  it('has unique names and valid object schemas', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(20);
      for (const req of t.inputSchema.required ?? []) expect(Object.keys(t.inputSchema.properties)).toContain(req);
    }
  });
  it('reports bad input as an error result, not a throw', async () => {
    expect(await runTool('nope', {}, toolCtx())).toEqual({ ok: false, error: 'Unknown tool "nope".' });
    const r = await runTool('otd_payout', { rarity: 'Super Rare' }, toolCtx());
    expect(r.ok).toBe(false);
  });
});

describe('otd tools', () => {
  it('otd_payout: Iconic is uncapped, Legendary 3 caps', async () => {
    const ic = await call('otd_payout', { rarity: 'Iconic', generalRaxPerSeason: 700, ratePerRating: 10 });
    expect(ic.multiplier).toBe(150);
    expect(ic.annualPayoutRax).toBe(105000);
    expect(ic.capped).toBe(false);
    expect(ic.costRax).toBe(200 + 3380 * 10);
    const lg = await call('otd_payout', { rarity: 'legendary 3', generalRaxPerSeason: 700 });
    expect(lg.multiplier).toBe(32);
    expect(lg.annualPayoutRax).toBe(16000);
    expect(lg.capped).toBe(true);
  });
  it('otd_payout: per-claim rounding matches the docs example (18 × Rare 4 = 72)', async () => {
    expect((await call('otd_payout', { rarity: 'Rare', baseRaxForDay: 18 })).perClaimRax).toBe(72);
  });
  it('otd_rules ladder starts at Common and ends at Iconic 20', async () => {
    const l = await call('otd_rules', { section: 'ladder' });
    expect(l.rungs[0].rarity).toBe('Common');
    expect(l.rungs.at(-1)).toMatchObject({ rarity: 'Iconic 20', multiplier: 250 });
  });
  it('otd_top_cards ranks by payout and filters by sport/player', async () => {
    const t = await call('otd_top_cards', { sport: 'NFL', rarity: 'Iconic', limit: 5 });
    expect(t.cards).toHaveLength(5);
    expect(t.cards.every((c: any) => c.sport === 'NFL')).toBe(true);
    const pays = t.cards.map((c: any) => c.annualPayoutRax);
    expect([...pays].sort((a, b) => b - a)).toEqual(pays);
    const pb = await call('otd_top_cards', { rarity: 'Epic', sortBy: 'payback', limit: 3 });
    expect(pb.cards[0].paybackDays).toBeLessThanOrEqual(pb.cards[1].paybackDays);
  });
});

describe('prediction maths tools', () => {
  it('ev_calc matches the Tab 9 formula', async () => {
    // fair 60%, Real shows 50%, rake 5% on payout: multiple = 2 × 0.95 = 1.9, EV = 0.6 × 1.9 − 1 = +14%
    const e = await call('ev_calc', { fairProb: 0.6, realPct: 50, bankroll: 1000 });
    expect(e.netPayoutMultiple).toBeCloseTo(1.9, 6);
    expect(e.evPct).toBeCloseTo(14, 6);
    expect(e.breakEvenRealPct).toBeCloseTo(57, 6);
    expect(e.recommendedStakeRax).toBeGreaterThan(0);
    // accepts percentages and a percent rake
    expect((await call('ev_calc', { fairProb: 60, realPct: 50, rake: 5 })).evPct).toBeCloseTo(14, 6);
    const neg = await call('ev_calc', { fairProb: 0.4, realPct: 50 });
    expect(neg.isPositiveEv).toBe(false);
    expect(neg.answer).toMatch(/^NO, not \+EV/);
    expect(e.isPositiveEv).toBe(true);
    expect(e.answer).toMatch(/^YES, \+EV/);
  });
  it('ev_calc validates', async () => {
    expect((await runTool('ev_calc', { fairProb: 150, realPct: 50 }, toolCtx())).ok).toBe(false);
    expect((await runTool('ev_calc', { fairProb: 0.5 }, toolCtx())).ok).toBe(false);
  });
  it('odds_convert round-trips', async () => {
    const a = await call('odds_convert', { american: -150 });
    expect(a.probabilityPct).toBeCloseTo(60, 2);
    expect(a.decimal).toBeCloseTo(1.6667, 3);
    expect((await call('odds_convert', { probability: 40 })).american).toBe(150);
    expect((await call('odds_convert', { fractional: '5/2' })).probabilityPct).toBeCloseTo(28.571, 2);
  });
  it('devig removes the overround', async () => {
    const d = await call('devig', { american: [-110, -110] });
    expect(d.fairPct).toEqual([50, 50]);
    expect(d.overroundPct).toBeCloseTo(4.76, 1);
    const p = await call('devig', { american: [-200, 170], method: 'power' });
    expect(p.fairPct[0] + p.fairPct[1]).toBeCloseTo(100, 1);
    expect(p.fairPct[0]).toBeGreaterThan(p.fairPct[1]);
  });
});

describe('rateboard + misc', () => {
  it('rateboard_owed rounds to 10 and formats the message', async () => {
    const r = await call('rateboard_owed', { rating: 87, rate: 20, player: 'Jaxon Smith-Njigba' });
    expect(r.owedRax).toBe(1740);
    expect(r.message).toBe('i have 87 Jaxon Smith-Njigba 1740');
  });
  it('quads_payouts totals the squad', async () => {
    expect((await call('quads_payouts', {})).tiers[0].squadTotal).toBe(200);
  });
  it('search_docs returns cited passages', async () => {
    const r = await call('search_docs', { query: 'how many claims per day on this day', limit: 3 });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].url).toMatch(/^https:\/\//);
  });
  it('read_doc lists and reads', async () => {
    const list = await call('read_doc', {});
    expect(list.documents.length).toBeGreaterThan(20);
    expect((await call('read_doc', { id: 'rax-site-guide' })).text).toContain('Tab 9');
    expect((await runTool('read_doc', { id: 'missing' }, toolCtx())).ok).toBe(false);
  });
});

describe('live data tools', () => {
  it('live_odds summarises consensus per game', async () => {
    const mk = (src: string, ml: [number, number]) => ({ source: src, type: 'moneyline', line: null, outcomes: [{ side: 'home', name: 'Bruins', implied: ml[0], american: null }, { side: 'away', name: 'Rangers', implied: ml[1], american: null }], updatedAt: '2026-10-11T00:00:00Z', volume: 5000, url: null, width: 0.01 });
    const getJson = vi.fn(async () => ({
      generatedAt: '2026-10-11T00:00:00Z', sport: 'NHL', sources: [{ source: 'kalshi', ok: true, count: 1 }],
      events: [{ id: 'x', sport: 'NHL', league: 'NHL', home: 'Bruins', away: 'Rangers', startsAt: '2026-10-11T23:00:00Z', status: 'scheduled', markets: [mk('kalshi', [0.6, 0.4]), mk('polymarket', [0.62, 0.38])] }],
    }));
    const r = await call('live_odds', { sport: 'nhl' }, toolCtx(getJson as any));
    expect(getJson).toHaveBeenCalledWith('/api/odds/events?sport=NHL');
    expect(r.games[0].game).toBe('Rangers @ Bruins');
    expect(r.games[0].moneyline.Bruins).toBeGreaterThan(59);
    expect(r.games[0].moneyline.sources).toContain('kalshi');
    expect((await runTool('live_odds', { sport: 'cricket' }, toolCtx(getJson as any))).ok).toBe(false);
  });
  it('schedule filters by sport', async () => {
    const games = [
      { id: '1', sport: 'NFL', title: '', broadcast: 'NBC', home: 'A', away: 'B', startsAt: '2026-10-12T00:00:00Z', pace: 1, pollsPerGame: 17, marquee: true },
      { id: '2', sport: 'NBA', title: '', broadcast: '', home: 'C', away: 'D', startsAt: '2026-10-12T00:00:00Z', pace: 1, pollsPerGame: 17, marquee: false },
    ];
    const r = await call('schedule', { sport: 'nfl' }, toolCtx((async () => ({ source: 'live', games })) as any));
    expect(r.games).toHaveLength(1);
    expect(r.games[0].game).toBe('B @ A');
  });
});
