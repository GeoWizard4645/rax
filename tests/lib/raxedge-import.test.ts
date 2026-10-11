import { describe, expect, it } from 'vitest';
import { RAXEDGE_EXPORT_SNIPPET, levelKey, parseRaxEdgeExport, raxedgeBookmarklet, reLevel, type RaxEdgeExport } from '../../shared/raxedgeImport';
import type { OtdCardRecord } from '../../shared/otdSnapshot';

const ds: OtdCardRecord[] = [
  { id: 'MLB|2025|1', sport: 'MLB', season: 2025, seasonLabel: '2025', playerId: '1', name: 'Yoshinobu Yamamoto', team: '', owners: null, games: 1, annual: 47, best: 47, days: [[1001, 47, 0]] },
];

describe('levelKey / reLevel', () => {
  it('maps RaxEdge levels to ladder keys', () => {
    expect([1, 2, 3, 4, 5, 9, 10, 19, 20, 21, 39].map(levelKey)).toEqual(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary 1', 'Legendary 5', 'Mystic 1', 'Mystic 10', 'Iconic', 'Iconic 2', 'Iconic 20']);
    expect(levelKey(0)).toBeNull();
  });
  it('players use the ladder; teams and fighters get their own scales and caps', () => {
    expect(reLevel('MLB', 'player', 20)).toEqual({ label: 'Iconic', rung: 'Iconic' });
    expect(reLevel('NBA', 'team', 20)!.fixed).toEqual({ multiplier: 6, annualCap: null, label: 'Team Iconic' });
    expect(reLevel('NBA', 'team', 3)!.fixed).toEqual({ multiplier: 1.6, annualCap: 4000, label: 'Team Rare' });
    expect(reLevel('UFC', 'player', 20)!.fixed!.multiplier).toBe(20);
    // RaxEdge's feed tags UFC fighters as entityType "team" — they must still get the UFC scale (20×, not the team 6×)
    expect(reLevel('UFC', 'team', 20)!.fixed).toMatchObject({ multiplier: 20, label: 'Fighter Iconic' });
    expect(reLevel('UFC', 'player', 4)!.fixed).toMatchObject({ multiplier: 2, annualCap: 12_000 });
  });
});

describe('parseRaxEdgeExport', () => {
  const exp: RaxEdgeExport = {
    v: 1, user: 'boston', at: '2026-10-11T00:00:00Z',
    passes: [
      ['mlb', '2025', 20, 'player', 808967, 'Yoshinobu Yamamoto', '1001:47,1008:10'],
      ['mlb', '2025', 20, 'player', 605141, 'Mookie Betts', '1001:26,1004:9'],
      ['mlb', '2025', 20, 'team', 12, 'Rangers', '1003:2'],
      ['ufc', '2023', 20, 'team', 99, 'Carlos Condit', '1003:84'],
      ['golf', '2025', 3, 'player', 47591, 'Eric Cole', '1005:25'],
      ['nba', '2026', 0, 'player', 5, 'General Guy', '101:5'],
      ['mlb', '2025', 20, 'player', 7, 'No Earnings', ''],
    ],
  };
  const r = parseRaxEdgeExport(JSON.stringify(exp), ds);
  it('links passes the dataset already has, and builds cards for the rest', () => {
    expect(r.matchedToDataset).toBe(1);
    expect(r.owned['MLB|2025|1']).toBe('Iconic');
    const ids = r.cards.map((c) => c.id).sort();
    // the matched dataset card (full schedule from RaxEdge) plus the four passes the dataset lacks
    expect(ids).toEqual(['MLB|2025|1', 're|MLB|2025|player|605141', 're|MLB|2025|team|12', 're|PGA|2025|player|47591', 're|UFC|2023|team|99'].sort());
    expect(r.cards.find((c) => c.id === 'MLB|2025|1')!.days).toEqual([[1001, 47, 0], [1008, 10, 0]]);
  });
  it('team and fighter cards carry their own multiplier; players use the ladder', () => {
    const team = r.cards.find((c) => c.kind === 'team')!;
    expect(team.fixed!.multiplier).toBe(6);
    expect(r.owned[team.id]).toBe('Team Iconic');
    expect(r.cards.find((c) => c.kind === 'fighter')!.fixed!.multiplier).toBe(20);
    const betts = r.cards.find((c) => c.name === 'Mookie Betts')!;
    expect(betts.fixed).toBeUndefined();
    expect(betts.annual).toBe(35);
    expect(betts.days).toEqual([[1001, 26, 0], [1004, 9, 0]]);
    expect(r.owned[betts.id]).toBe('Iconic');
    expect(r.owned['PGA'] ?? r.owned['re|PGA|2025|player|47591']).toBe('Rare');
  });
  it('skips General-level passes and ones with no earnings, and says so', () => {
    expect(r.errors.join(' ')).toMatch(/2 pass\(es\) skipped/);
  });
  it('rejects garbage', () => {
    expect(parseRaxEdgeExport('not json', ds).errors[0]).toMatch(/invalid JSON/);
    expect(parseRaxEdgeExport('{"v":2}', ds).errors[0]).toMatch(/Unrecognised/);
  });
});

describe('snippet', () => {
  it('is valid JavaScript, sends nothing anywhere but the clipboard, and collapses to a bookmarklet', () => {
    expect(() => new Function(RAXEDGE_EXPORT_SNIPPET)).not.toThrow();
    expect(RAXEDGE_EXPORT_SNIPPET).not.toMatch(/fetch\(['"`]https?:/); // only same-origin raxedge calls
    expect(RAXEDGE_EXPORT_SNIPPET).not.toMatch(/rax\.vivaanshahani|XMLHttpRequest|sendBeacon/);
    const b = raxedgeBookmarklet();
    expect(b.startsWith('javascript:')).toBe(true);
    expect(() => new Function(decodeURIComponent(b.slice(11)))).not.toThrow();
  });
});
