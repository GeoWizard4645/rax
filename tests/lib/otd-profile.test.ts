import { describe, expect, it } from 'vitest';
import { matchCollection, parseLevel, parsePasses, raxSeasonFromText, recordFromGames } from '../../shared/otdProfile';
import type { OtdCardRecord } from '../../shared/otdSnapshot';

const card = (id: string, sport: OtdCardRecord['sport'], name: string, season: number, seasonLabel: string, annual: number): OtdCardRecord => ({
  id, sport, season, seasonLabel, playerId: id, name, team: 'T', owners: null, games: 1, annual, best: 10, days: [[1004, 10, 0]],
});
const cards = [
  card('a', 'NFL', 'Saquon Barkley', 2024, '24-25', 707),
  card('b', 'NFL', 'Saquon Barkley', 2023, '23-24', 300),
  card('c', 'MLB', 'Shohei Ohtani', 2025, '2025', 715),
];

describe('parseLevel', () => {
  it('accepts tiers, sub-levels and bare names', () => {
    expect(parseLevel('Mystic 3')).toBe('Mystic 3');
    expect(parseLevel('legendary')).toBe('Legendary 1');
    expect(parseLevel('Iconic')).toBe('Iconic');
    expect(parseLevel('Iconic 1')).toBe('Iconic');
    expect(parseLevel('iconic 12')).toBe('Iconic 12');
    expect(parseLevel('General')).toBeNull();
    expect(parseLevel('nonsense')).toBeNull();
  });
});

describe('parsePasses', () => {
  it('matches by sport, name (accent/case-insensitive) and season spelling', () => {
    const r = parsePasses('saquon barkley, NFL, 2024-25, Mystic 3\nShohei Ohtani, mlb, 2025, Iconic', cards);
    expect(r.errors).toEqual([]);
    expect(r.owned).toEqual({ a: 'Mystic 3', c: 'Iconic' });
  });
  it('reports lines it cannot use', () => {
    const r = parsePasses('Nobody, NFL, 24-25, Epic\nSaquon Barkley, NFL, 24-25, Banana\nSaquon Barkley, NFL, 22-23, Epic', cards);
    expect(Object.keys(r.owned)).toHaveLength(0);
    // 'Banana' is a bad level (error); the other two are well-formed passes missing from the dataset → looked up live.
    expect(r.errors).toHaveLength(1);
    expect(r.missing.map((m) => [m.name, m.season])).toEqual([['Nobody', 2024], ['Saquon Barkley', 2022]]);
  });
});

describe('matchCollection', () => {
  it('maps pulled players to season cards and rung-if-concentrated', () => {
    const { held, unmatched } = matchCollection([{ name: 'Saquon Barkley', total: 12, totalValue: 400 }, { name: 'Unknown Guy', total: 1, totalValue: 5 }], 'NFL', cards);
    expect(held).toHaveLength(1);
    expect(held[0].seasons.map((c) => c.id)).toEqual(['a', 'b']);
    expect(held[0].rungIfConcentrated).toBe('Legendary 1');
    expect(unmatched.map((p) => p.name)).toEqual(['Unknown Guy']);
  });
});

describe('raxSeasonFromText', () => {
  it('maps the community label to Rax\'s season number', () => {
    expect(raxSeasonFromText('NFL', '24-25')).toBe(2024);
    expect(raxSeasonFromText('NBA', '23-24')).toBe(2024);
    expect(raxSeasonFromText('CBB', '2023-24')).toBe(2024);
    expect(raxSeasonFromText('MLB', '2025')).toBe(2025);
    expect(raxSeasonFromText('MLB', 'nope')).toBeNull();
  });
});

describe('recordFromGames', () => {
  it('keeps every game, sums the season and flags the postseason', () => {
    const r = recordFromGames('MLB', 2022, 'Shohei Ohtani', [
      { day: '2022-10-03', rax: 2, seasonType: 'regular', playerId: 7 },
      { day: '2022-04-07', rax: 30, seasonType: 'regular', playerId: 7 },
      { day: '2022-10-09', rax: 12, seasonType: 'postseason', playerId: 7 },
      { day: '2022-05-01', rax: 0 },
    ]);
    expect(r!.id).toBe('MLB|2022|7');
    expect(r!.annual).toBe(44);
    expect(r!.days).toEqual([[407, 30, 0], [1003, 2, 0], [1009, 12, 1]]);
    expect(r!.best).toBe(30);
    expect(recordFromGames('MLB', 2022, 'X', [])).toBeNull();
  });
});
