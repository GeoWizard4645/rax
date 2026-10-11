import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __reset, noteRoute, registerSurface, setNavigator } from '../../src/agent/bridge';
import { PARAM_CATALOG } from '../../src/agent/catalog';
import { offlineReply, parseAssignments } from '../../src/agent/offline';

describe('parseAssignments', () => {
  const eff = PARAM_CATALOG.efficiency;
  it('reads several "name to value" pairs', () => {
    expect(parseAssignments('rarity to Legendary 3, budget to 50k and sports to NFL, NBA', eff)).toEqual({ rarity: 'Legendary 3', budget: '50k', sports: 'NFL, NBA' });
  });
  it('understands aliases and "=" forms', () => {
    const r = parseAssignments('level = epic; spend: 20000; window to 30', eff);
    expect(r).toMatchObject({ rarity: 'epic', budget: '20000', timeframe: '30' });
  });
  it('handles edge params', () => {
    expect(parseAssignments('bankroll to 2,000 and kelly to 0.5', PARAM_CATALOG.edge)).toMatchObject({ bankroll: '2,000', kellyFraction: '0.5' });
  });
  it('returns nothing when there is no parameter', () => {
    expect(parseAssignments('what a lovely day', eff)).toEqual({});
  });
});

describe('offlineReply', () => {
  const st = { rarity: 'Iconic', budget: 100000 };
  beforeEach(() => {
    __reset();
    noteRoute('/efficiency');
    registerSurface('efficiency', {
      current: {
        summary: () => st,
        params: {
          rarity: { get: () => st.rarity, set: (v) => void (st.rarity = v as string) },
          budget: { get: () => st.budget, set: (v) => void (st.budget = v as number) },
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies "set …" requests to the current tab and supports undo', async () => {
    const r = await offlineReply('set rarity to epic and budget to 25k');
    expect(r.text).toMatch(/Done on \*\*OTD Efficiency\*\*/);
    expect(st).toEqual({ rarity: 'Epic', budget: 25000 });
    expect(r.steps[0].ok).toBe(true);
    const u = await offlineReply('undo');
    expect(u.steps[0].ok).toBe(true);
    expect(st).toEqual({ rarity: 'Iconic', budget: 100000 });
  });
  it('explains rejected values', async () => {
    const r = await offlineReply('set rarity to sparkly');
    expect(r.text).toMatch(/couldn't apply/i);
    expect(st.rarity).toBe('Iconic');
  });
  it('does maths without the network', async () => {
    expect((await offlineReply('15% of 2,000')).text).toContain('300');
    expect((await offlineReply('what is (1200*0.35 + 300)/12')).text).toContain('60');
  });
  it('navigates by name', async () => {
    const seen: string[] = [];
    setNavigator((to) => {
      seen.push(to);
      noteRoute(to);
      registerSurface('edge', { current: { summary: () => ({}), params: {} } });
    });
    const r = await offlineReply('take me to the edge tab');
    expect(seen).toEqual(['/edge']);
    expect(r.text).toMatch(/Opened \*\*Edge \/ EV\*\*/);
  });
  it('falls back to docs search and cites sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ title: 'Real docs — On this day', section: 'Claims', url: 'https://docs.realapp.link/collect/on-this-day', text: 'Two guaranteed claims per sport per day.' }] }), { headers: { 'Content-Type': 'application/json' } })));
    const r = await offlineReply('how many claims do I get per day?');
    expect(r.text).toContain('https://docs.realapp.link/collect/on-this-day');
    expect(r.text).toMatch(/offline mode/);
  });
  it('degrades politely when the docs endpoint is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await offlineReply('explain karma')).text).toMatch(/can't reach/);
  });
});
