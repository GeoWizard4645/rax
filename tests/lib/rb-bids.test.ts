import { describe, expect, it } from 'vitest';
import { blankBoard, type RbBoard, type RbOffer } from '../../shared/rateboard';
import { contenders, radarRows, radarStats, toRbBids, wantsOf } from '../../shared/rbBids';
import { rbKey } from '../../shared/rbHistory';

const T = Date.UTC(2026, 9, 10);
const o = (id: string, user: string, player: string, rate: number, sport: RbOffer['sport'] = 'NFL', ts = T): RbOffer => ({ id, user, sport, player, rate, link: `https://www.realapp.com/x/${id}`, ts });
const mk = (offers: RbOffer[], extra: Partial<RbBoard> = {}): RbBoard => {
  const b = blankBoard();
  for (const x of offers) b.users[x.user] ??= { name: x.user.toUpperCase(), hasPassword: true };
  return { ...b, offers, ...extra };
};

describe('toRbBids', () => {
  it('maps live offers to bids and drops banned buyers', () => {
    const b = mk([o('1', 'a', 'Josh Allen', 20), o('2', 'z', 'Josh Allen', 50)]);
    b.users.z.banned = true;
    const bids = toRbBids(b);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ who: 'A', rate: 20, key: rbKey('NFL', 'Josh Allen'), link: 'https://www.realapp.com/x/1' });
  });
});

describe('radarRows', () => {
  const board = mk([
    o('1', 'a', 'Josh Allen', 40),
    o('2', 'b', 'Josh Allen', 20),
    o('3', 'c', 'Josh Allen', 20),
    o('4', 'd', 'Bo Nix', 30), // alone on the player -> sport median
    o('5', 'e', 'Jared Goff', 10),
  ]);
  it('prefers recorded history, then the other buyers, then the sport median — and says which', () => {
    const key = rbKey('NFL', 'Josh Allen');
    const withHist = radarRows(board, { [key]: 25 });
    const a = withHist.find((r) => r.id === '1')!;
    expect(a.baselineKind).toBe('history');
    expect(a.premium).toBeCloseTo(60);
    const rows = radarRows(board);
    const a2 = rows.find((r) => r.id === '1')!;
    expect(a2.baselineKind).toBe('others');
    expect(a2.baseline).toBe(20);
    expect(a2.premium).toBeCloseTo(100);
    expect(a2.buyers).toBe(3);
    const nix = rows.find((r) => r.id === '4')!;
    expect(nix.baselineKind).toBe('sport');
    expect(nix.baseline).toBe(20); // median of 40,20,20,30,10
  });
  it('leaves rating and rarity out entirely (unknown, not invented)', () => {
    const r = radarRows(board)[0] as unknown as Record<string, unknown>;
    expect('rating' in r || 'rarity' in r || 'cardRating' in r).toBe(false);
  });
  it('does not count weak (sport-median) comparisons as bidding wars or top premium', () => {
    const rows = radarRows(board);
    const st = radarStats(rows);
    // Bo Nix (30) and Jared Goff (10) are lone bids compared with the sport median only -> excluded from hot/topPremium
    expect(rows.find((r) => r.id === '4')!.baselineKind).toBe('sport');
    expect(st.hot).toBe(1); // only Josh Allen's 40 vs others' median 20
    expect(st.topPremium).toBeCloseTo(100);
    expect(st.bids).toBe(5);
  });
  it('carries floor and house rates, and radarStats counts bidding wars', () => {
    const b = mk([o('1', 'a', 'Julian Love', 16), o('2', 'b', 'Julian Love', 8), o('3', 'c', 'Julian Love', 8)], {
      minimums: [{ sport: 'NFL', player: 'Julian Love', rate: 8 }],
      house: [{ sport: 'NFL', player: 'Julian Love', rate: 12 }],
    });
    const rows = radarRows(b);
    expect(rows[0]).toMatchObject({ floor: 8, house: 12 });
    const st = radarStats(rows);
    expect(st).toMatchObject({ bids: 3, buyers: 3, players: 1, hot: 1 });
    expect(st.topPremium).toBeCloseTo(100);
  });
});

describe('contenders', () => {
  const board = mk([
    o('1', 'a', 'Josh Allen', 40),
    o('2', 'a', 'Bo Nix', 30),
    o('3', 'a', 'Jared Goff', 20, 'NFL', T + 1000),
    o('4', 'b', 'Josh Allen', 20),
    o('5', 'c', 'Josh Allen', 20),
    o('6', 'c', 'Bo Nix', 15),
  ]);
  it('ranks buyers with several standing offers; counts offers above market', () => {
    const list = contenders(radarRows(board));
    expect(list.map((c) => c.user)).toEqual(['a', 'c']);
    expect(list[0]).toMatchObject({ offers: 3, topRate: 40 });
    expect(list[0].above).toBeGreaterThanOrEqual(1);
    expect(list[0].lastTs).toBe(T + 1000);
    expect(contenders(radarRows(board), 3).map((c) => c.user)).toEqual(['a']);
  });
  it('wantsOf finds the cards in your collection', () => {
    const c = contenders(radarRows(board))[0];
    expect(wantsOf(c, new Set(['josh allen'])).map((w) => w.player)).toEqual(['Josh Allen']);
    expect(wantsOf(c, new Set())).toEqual([]);
  });
});
