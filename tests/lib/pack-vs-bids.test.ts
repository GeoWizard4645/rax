import { describe, expect, it } from 'vitest';
import { packVsBids, THIN_SAMPLE } from '../../shared/packVsBids';
import type { PackRow } from '../../shared/raxedgeBridge';
import type { RbAgg } from '../../shared/rbHistory';

const agg = (name: string, sport: RbAgg['sport'], best: number, buyers = 1): RbAgg => ({ key: `${sport}:${name}`, sport, name, best, med: best, buyers, offers: buyers, house: 0 });
const row = (sport: string, season: string, name: string, avg: number, total: number): PackRow => [sport, season, `id-${name}-${season}`, name, 'QB', avg, total, 10, 5, 20];

describe('packVsBids', () => {
  const rows: PackRow[] = [row('nfl', '2023', 'Saquon Barkley', 3.73, 37), row('nfl', '2025', 'Saquon Barkley', 8.54, 3), row('ncaaf', '2025', 'Julian Sayin', 5, 12)];
  it('compares the cost of a rating point through packs with the best bid, per player', () => {
    const out = packVsBids([agg('Saquon Barkley', 'NFL', 30, 4), agg('Julian Sayin', 'CFB', 12), agg('Nobody Here', 'NFL', 50)], rows, 271);
    expect(out.map((r) => r.player)).toEqual(['Saquon Barkley', 'Julian Sayin']); // Nobody has no pack row -> no row, nothing invented
    const b = out[0];
    expect(b.seasons).toHaveLength(2);
    expect(b.cheapest.season).toBe('2025'); // 271 / (3 x 8.54) = 10.6 beats 24.2
    expect(b.cheapest.cost).toBeCloseTo(271 / (3 * 8.54), 6);
    expect(b.cheapest.thin).toBe(true); // 3 pulls < THIN_SAMPLE
    expect(b.spread).toBeCloseTo(30 - 271 / (3 * 8.54), 6);
    expect(THIN_SAMPLE).toBe(5);
    expect(out[1].cheapest.cost).toBeCloseTo(271 / 15, 6);
  });
  it('matches accents/suffixes the Rateboard way, maps CFB to ncaaf, and ignores players with no bid', () => {
    const r2: PackRow[] = [row('ncaaf', '2025', 'Billy Edwards Jr.', 4, 9), row('nfl', '2025', 'Sam Nobid', 6, 9)];
    expect(packVsBids([agg('Billy Edwards', 'CFB', 15)], r2, 271)).toHaveLength(1);
    expect(packVsBids([agg('Sam Nobid', 'NFL', 0)], r2, 271)).toEqual([]);
    expect(packVsBids([agg('Billy Edwards', 'NFL', 15)], r2, 271)).toEqual([]); // wrong sport
  });
  it('returns nothing without pack data or with a bad pack price', () => {
    expect(packVsBids([agg('A B', 'NFL', 10)], null)).toEqual([]);
    expect(packVsBids([agg('A B', 'NFL', 10)], rows, 0)).toEqual([]);
  });
});
