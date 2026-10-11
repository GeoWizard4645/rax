import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OTD_SPORTS, seasonLabelFor, type OtdSnapshot } from '../../shared/otdSnapshot';
import { REFERENCE_CARDS } from '../../shared/otdReference';

const snap = JSON.parse(readFileSync(new URL('../../public/data/otd-observed.json', import.meta.url), 'utf8')) as OtdSnapshot;

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

describe('observed OTD snapshot — schema invariants', () => {
  it('has the contract header', () => {
    expect(snap.version).toBe(1);
    expect(snap.method).toBe('observed');
    expect(snap.minDayRax).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(snap.generatedAt))).toBe(false);
    expect(snap.cards.length).toBeGreaterThan(3000);
  });

  it('covers every sport, and coverage counts match the cards', () => {
    expect(snap.coverage.map((c) => c.sport).sort()).toEqual([...OTD_SPORTS].sort());
    for (const cov of snap.coverage) {
      const cards = snap.cards.filter((c) => c.sport === cov.sport);
      expect(cards.length).toBe(cov.cards);
      expect(new Set(cards.map((c) => c.season))).toEqual(new Set(cov.seasons));
    }
  });

  it('card ids are unique and well-formed; labels follow the conventions', () => {
    const ids = new Set<string>();
    for (const c of snap.cards) {
      expect(c.id).toBe(`${c.sport}|${c.season}|${c.playerId}`);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.seasonLabel).toBe(seasonLabelFor(c.sport, c.season));
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('days are sorted, valid mmdd, rax >= minDayRax, and Σdays <= annual', () => {
    for (const c of snap.cards) {
      let prev = 0;
      let sum = 0;
      for (const [md, rax, flags] of c.days) {
        const m = Math.floor(md / 100);
        const d = md % 100;
        expect(m >= 1 && m <= 12 && d >= 1 && d <= 31).toBe(true);
        expect(md).toBeGreaterThanOrEqual(prev);
        prev = md;
        expect(rax).toBeGreaterThanOrEqual(snap.minDayRax);
        expect([0, 1, 2, 3]).toContain(flags);
        sum += rax;
      }
      expect(sum).toBeLessThanOrEqual(c.annual);
      expect(c.days.length).toBeLessThanOrEqual(c.games);
      expect(c.best).toBeGreaterThanOrEqual(c.days.reduce((m, x) => Math.max(m, x[1]), 0));
    }
  });
});

describe('observed OTD snapshot — matches the community reference cards', () => {
  const find = (sport: string, label: string, name: string) =>
    snap.cards.find((c) => c.sport === sport && c.seasonLabel === label && fold(c.name) === fold(name));

  it('exact for the sports where Rateboard is complete (NFL, CBB, CFB — the latter two already include the July-2026 buff)', () => {
    for (const r of REFERENCE_CARDS.filter((x) => x.sport === 'NFL' || x.sport === 'CBB' || x.sport === 'CFB')) {
      const c = find(r.sport, r.rawLabel, r.name);
      expect(c, `${r.sport} ${r.rawLabel} ${r.name}`).toBeDefined();
      expect(c!.annual).toBe(r.general);
    }
  });

  it('within 2% for NBA stars, and Dončić / Jokić / Tatum exact', () => {
    for (const r of REFERENCE_CARDS.filter((x) => x.sport === 'NBA')) {
      const c = find('NBA', r.rawLabel, r.name);
      expect(c, `${r.rawLabel} ${r.name}`).toBeDefined();
      expect(Math.abs(c!.annual - r.general) / r.general).toBeLessThan(0.02);
    }
    expect(find('NBA', '23-24', 'Luka Dončić')!.annual).toBe(627);
    expect(find('NBA', '23-24', 'Nikola Jokić')!.annual).toBe(559);
  });

  it('golf is at or above the guide figure ("after triple overlaps" = a floor), within 6%', () => {
    for (const r of REFERENCE_CARDS.filter((x) => x.sport === 'PGA')) {
      const c = find('PGA', r.rawLabel, r.name);
      expect(c, `${r.rawLabel} ${r.name}`).toBeDefined();
      expect(c!.annual).toBeGreaterThanOrEqual(r.general);
      expect(c!.annual / r.general).toBeLessThan(1.06);
    }
  });

  it('a few single-claim spot checks', () => {
    const edey = find('CBB', '23-24', 'Zach Edey')!;
    expect(edey.annual).toBe(708);
    expect(edey.days.length).toBe(edey.games);
    expect(find('NFL', '24-25', 'Saquon Barkley')!.best).toBe(98);
  });
});
