import { beforeEach, describe, expect, it } from 'vitest';
import { __reset, describe as describeApp, noteRender, noteRoute, registerSurface, runAction, setNavigator, setParams, undo } from '../../src/agent/bridge';
import { coerceParam, parseNumber } from '../../src/agent/coerce';
import { PARAM_CATALOG } from '../../src/agent/catalog';
import { SITE_TABS } from '../../shared/agent/siteMap';

describe('parseNumber', () => {
  it.each([['50k', 50000], ['1.5m', 1500000], ['$2,500', 2500], ['75%', 75], [' 12 ', 12], [7, 7], ['-3', -3]])('%s → %s', (i, o) => expect(parseNumber(i)).toBe(o));
  it.each(['abc', '', null, undefined, '1e3x', NaN])('%s → null', (i) => expect(parseNumber(i)).toBeNull());
});

describe('coerceParam', () => {
  const rarity = PARAM_CATALOG.efficiency.find((p) => p.name === 'rarity')!;
  const sports = PARAM_CATALOG.efficiency.find((p) => p.name === 'sports')!;
  const budget = PARAM_CATALOG.efficiency.find((p) => p.name === 'budget')!;
  it('enums: case/space-insensitive, unique prefix, rejects the rest', () => {
    expect(coerceParam(rarity, 'legendary 3')).toEqual({ ok: true, value: 'Legendary 3' });
    expect(coerceParam(rarity, 'LEGENDARY3')).toEqual({ ok: true, value: 'Legendary 3' });
    expect(coerceParam(rarity, 'auto')).toEqual({ ok: true, value: 'AUTO' });
    expect(coerceParam(rarity, 'Iconic')).toEqual({ ok: true, value: 'Iconic' }); // exact beats "Iconic 2" prefix
    expect(coerceParam(rarity, 'super rare').ok).toBe(false);
    expect(coerceParam(rarity, 'Legendary').ok).toBe(false); // ambiguous prefix
  });
  it('numbers honour min/max and k/m suffixes', () => {
    expect(coerceParam(budget, '50k')).toEqual({ ok: true, value: 50000 });
    expect(coerceParam(budget, -5).ok).toBe(false);
    expect(coerceParam(PARAM_CATALOG.efficiency.find((p) => p.name === 'maxCards')!, 99).ok).toBe(false);
    expect(coerceParam(PARAM_CATALOG.efficiency.find((p) => p.name === 'maxCards')!, 2.5).ok).toBe(false);
  });
  it('string lists: split text, normalise members, "all" clears', () => {
    expect(coerceParam(sports, 'nfl, nba and mlb')).toEqual({ ok: true, value: ['NFL', 'NBA', 'MLB'] });
    expect(coerceParam(sports, ['nfl', 'NFL'])).toEqual({ ok: true, value: ['NFL'] });
    expect(coerceParam(sports, 'all')).toEqual({ ok: true, value: [] });
    expect(coerceParam(sports, ['cricket']).ok).toBe(false);
  });
  it('dates and booleans', () => {
    const d = PARAM_CATALOG.efficiency.find((p) => p.name === 'startDate')!;
    expect(coerceParam(d, '2026-12-01')).toEqual({ ok: true, value: '2026-12-01' });
    expect(coerceParam(d, 'today')).toEqual({ ok: true, value: '' });
    expect(coerceParam(d, 'next friday').ok).toBe(false);
    const b = PARAM_CATALOG.efficiency.find((p) => p.name === 'capLifetime')!;
    expect(coerceParam(b, 'yes')).toEqual({ ok: true, value: true });
    expect(coerceParam(b, 'maybe').ok).toBe(false);
  });
});

describe('catalog', () => {
  it('has an entry per tab and unique names within each', () => {
    for (const t of SITE_TABS) {
      const names = PARAM_CATALOG[t.id].map((p) => p.name);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it('every enum/list has values and every number has sane bounds', () => {
    for (const metas of Object.values(PARAM_CATALOG)) for (const m of metas) {
      if (m.type === 'enum') expect(m.values?.length).toBeGreaterThan(1);
      if (m.min !== undefined && m.max !== undefined) expect(m.min).toBeLessThan(m.max);
    }
  });
});

/** A stand-in for a mounted tab: plain variables behind getters/setters. */
function fakeEfficiency() {
  const st = { rarity: 'Iconic', budget: 100000, sports: [] as string[], timeframe: '90' };
  const ref = {
    current: {
      summary: () => ({ ...st }),
      params: {
        rarity: { get: () => st.rarity, set: (v: unknown) => void (st.rarity = v as string) },
        budget: { get: () => st.budget, set: (v: unknown) => void (st.budget = v as number) },
        sports: { get: () => st.sports, set: (v: unknown) => void (st.sports = v as string[]) },
        timeframe: { get: () => st.timeframe, set: (v: unknown) => void (st.timeframe = v as string) },
      },
      actions: { reset: () => { st.rarity = 'Iconic'; return 'reset'; } },
    },
  };
  return { st, ref };
}

describe('bridge', () => {
  beforeEach(() => __reset());

  it('describes live tabs with params and current values', () => {
    const { ref } = fakeEfficiency();
    noteRoute('/efficiency');
    registerSurface('efficiency', ref);
    const ctx = describeApp();
    const eff = ctx.tabs.find((t) => t.id === 'efficiency')!;
    expect(eff.active).toBe(true);
    expect(eff.params!.find((p) => p.name === 'budget')!.value).toBe(100000);
    expect(eff.params!.find((p) => p.name === 'rarity')!.values).toContain('Legendary 3');
    expect(eff.actions!.map((a) => a.name)).toEqual(['reset']);
    expect(ctx.activity).toContain('opened Tab 7 (OTD Efficiency)');
  });

  it('applies valid values, rejects invalid ones with reasons, and reads back', async () => {
    const { st, ref } = fakeEfficiency();
    noteRoute('/efficiency');
    registerSurface('efficiency', ref);
    const r = await setParams('efficiency', { rarity: 'legendary 3', budget: '50k', Sports: 'nfl', timeframe: 'fortnight', bogus: 1 });
    expect(r.applied).toEqual({ rarity: 'Legendary 3', budget: 50000, sports: ['NFL'] });
    expect(Object.keys(r.rejected).sort()).toEqual(['bogus', 'timeframe']);
    expect(r.rejected.bogus).toMatch(/Valid:/);
    expect(st).toMatchObject({ rarity: 'Legendary 3', budget: 50000, sports: ['NFL'], timeframe: '90' });
    expect(r.current.budget).toBe(50000);
  });

  it('undo restores the previous values, and only once', async () => {
    const { st, ref } = fakeEfficiency();
    noteRoute('/efficiency');
    registerSurface('efficiency', ref);
    await setParams('efficiency', { rarity: 'Epic', budget: 5 });
    await setParams('efficiency', { rarity: 'Rare' });
    expect((await undo()).ok).toBe(true);
    expect(st.rarity).toBe('Epic');
    expect((await undo()).ok).toBe(true);
    expect(st).toMatchObject({ rarity: 'Iconic', budget: 100000 });
    expect((await undo()).ok).toBe(false);
  });

  it('opens an unmounted tab before applying, via the navigator', async () => {
    const { st, ref } = fakeEfficiency();
    let unregister = () => {};
    setNavigator((to) => {
      noteRoute(to);
      setTimeout(() => { unregister = registerSurface('efficiency', ref); }, 60);
    });
    noteRoute('/edge');
    const r = await setParams('efficiency', { rarity: 'Epic' });
    expect(r.applied.rarity).toBe('Epic');
    expect(st.rarity).toBe('Epic');
    expect(describeApp().route).toBe('/efficiency');
    unregister();
  });

  it('reports failure if the tab never mounts', async () => {
    setNavigator(() => {});
    const t0 = Date.now();
    const r = await setParams('efficiency', { rarity: 'Epic' });
    expect(Object.keys(r.applied)).toHaveLength(0);
    expect(r.rejected.rarity).toMatch(/Could not open/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5900);
  }, 10000);

  it('keeps the last state of a tab after it unmounts', () => {
    const { st, ref } = fakeEfficiency();
    noteRoute('/efficiency');
    const off = registerSurface('efficiency', ref);
    st.budget = 777;
    off();
    noteRoute('/edge');
    const eff = describeApp().tabs.find((t) => t.id === 'efficiency')!;
    expect(eff.active).toBe(false);
    expect(eff.seen).toBe(true);
    expect((eff.summary as any).budget).toBe(777);
    expect(eff.params).toBeUndefined();
  });

  it('logs changes the user makes, but not the assistant\'s', async () => {
    const { st, ref } = fakeEfficiency();
    noteRoute('/efficiency');
    registerSurface('efficiency', ref);
    st.budget = 42; // user typed
    noteRender('efficiency');
    expect(describeApp().activity.some((l) => l.startsWith('You set Tab 7 budget → 42'))).toBe(true);
    await setParams('efficiency', { rarity: 'Epic' });
    noteRender('efficiency');
    expect(describeApp().activity.filter((l) => l.startsWith('You set')).length).toBe(1);
    expect(describeApp().activity.some((l) => l.includes('(assistant)') && l.includes('rarity'))).toBe(true);
  });

  it('runs only catalogued actions', async () => {
    const { ref } = fakeEfficiency();
    noteRoute('/efficiency');
    registerSurface('efficiency', ref);
    expect((await runAction('efficiency', 'reset')).ok).toBe(true);
    const bad = await runAction('efficiency', 'format_disk');
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/Available: reset/);
  });
});
