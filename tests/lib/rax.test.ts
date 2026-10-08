import { describe, expect, it } from 'vitest';
import { buildRaxQuery, seasonLabel, statsByName, toHistoricalGame, topCards } from '../../shared/rax';

const qs = (s: string) => buildRaxQuery(new URLSearchParams(s));

describe('seasonLabel', () => {
  it('follows each sport\'s labelling', () => {
    expect(seasonLabel('nfl', '2026-01-18')).toBe(2025); // playoffs belong to the season that started in the autumn
    expect(seasonLabel('nfl', '2025-09-07')).toBe(2025);
    expect(seasonLabel('nhl', '2026-06-01')).toBe(2025);
    expect(seasonLabel('ncaaf', '2025-12-20')).toBe(2025);
    expect(seasonLabel('nba', '2025-10-22')).toBe(2026); // NBA / CBB use the ending year
    expect(seasonLabel('nba', '2026-04-10')).toBe(2026);
    expect(seasonLabel('ncaam', '2023-11-06')).toBe(2024);
    expect(seasonLabel('mlb', '2024-07-04')).toBe(2024);
    expect(seasonLabel('golf', '2019-04-14')).toBe(2019);
  });
});

describe('buildRaxQuery', () => {
  const ok = 'gamelog=query&mode=games&sport=nfl&season=2025&seasons=nfl:2024,nfl:2025&fromMD=10-12&toMD=10-12&sort=rax&dir=desc&limit=500';
  it('rebuilds an allowed query from known keys only', () => {
    expect(qs('gamelog=seasons&evil=1')).toBe('gamelog=seasons');
    const out = new URLSearchParams(qs(ok + '&golf=allevents&admin=1')!);
    expect(out.get('mode')).toBe('games');
    expect(out.get('seasons')).toBe('nfl:2024,nfl:2025');
    expect(out.has('golf')).toBe(false);
    expect(out.has('admin')).toBe(false);
  });
  it('rejects queries outside the allow-list', () => {
    expect(qs('')).toBeNull();
    expect(qs('gamelog=top&sport=nfl&season=2025')).toBeNull();
    expect(qs('golf=allevents&sport=golf')).toBeNull();
    expect(qs(ok.replace('mode=games', 'mode=dump'))).toBeNull();
    expect(qs(ok.replace('limit=500', 'limit=501'))).toBeNull();
    expect(qs(ok.replace('sort=rax', 'sort=hash'))).toBeNull();
    expect(qs(ok.replace('fromMD=10-12', 'fromMD=a-b'))).toBeNull();
    expect(qs(ok.replace('nfl:2024,nfl:2025', 'nfl:2024;drop'))).toBeNull();
    expect(qs('gamelog=query&mode=players&sport=nfl&season=2025')).toBeNull(); // seasons required
  });
  it('accepts a player search', () => {
    expect(qs('gamelog=query&mode=players&sport=nfl&season=2026&seasons=nfl:2026&q=Josh%20Allen&limit=5')).toContain('q=Josh+Allen');
  });
});

describe('row conversion', () => {
  it('maps a game row to a HistoricalGame and skips junk', () => {
    expect(toHistoricalGame('nfl', { day: '2025-10-12', player: 'Josh Allen', team: 'BUF', rax: 84.4, rating: 7.1995, playerId: 18877 })).toEqual({
      id: 'nfl-18877-2025-10-12', playerId: '18877', playerName: 'Josh Allen', sport: 'NFL', team: 'BUF', season: '2025', date: '2025-10-12', rating: 7.2, baseRax: 84,
    });
    expect(toHistoricalGame('ncaaf', { day: '2024-10-12', player: 'X', rax: 5 }, 2024)?.sport).toBe('CFB');
    expect(toHistoricalGame('soccer', { day: '2025-10-12', player: 'X', rax: 5 })).toBeNull();
    expect(toHistoricalGame('nfl', { day: '2025-10-12', player: 'X', rax: 0 })).toBeNull();
    expect(toHistoricalGame('nfl', { day: 'nope', player: 'X', rax: 3 })).toBeNull();
  });
  it('indexes player stats by normalised name, first row wins', () => {
    const m = statsByName([{ player: 'Josh Allen', rax: 98, owners: 39864 }, { player: 'josh allen', rax: 1 }]);
    expect(m.get('josh allen')).toMatchObject({ rax: 98, owners: 39864 });
  });
  it('picks the biggest anniversaries per sport, one per card', () => {
    const g = (n: string, season: string, rax: number, sport: any = 'NFL') => ({ id: n + season + rax, playerId: n, playerName: n, sport, team: '', season, date: '2025-10-12', rating: 5, baseRax: rax });
    const cards = topCards([g('A', '2024', 50), g('A', '2024', 90), g('B', '2025', 70), g('C', '2023', 10), g('Z', '2022', 5, 'NBA')], 2);
    expect(cards).toEqual([
      { playerName: 'A', sport: 'NFL', season: '2024' },
      { playerName: 'B', sport: 'NFL', season: '2025' },
      { playerName: 'Z', sport: 'NBA', season: '2022' },
    ]);
  });
});
