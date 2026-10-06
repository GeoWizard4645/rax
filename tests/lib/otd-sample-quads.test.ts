import { describe, expect, it } from 'vitest';
import { breakEvenDays, cardId, cardRoi, compareCards, gameYield, parseGamesInput, planDay, type OwnedCard } from '../../shared/otd';
import { QUAD_PAYOUTS, karmaOpportunity, readPoll, squadTotal } from '../../shared/quads';
import { sampleAuctions, sampleCatalysts, sampleOtdGames, sampleQuads, sampleSeries, samplePlayers } from '../../shared/sample';
import { summarizeMarket } from '../../shared/market';
import { buildCandles, playerKey } from '../../shared/formulas';
import type { HistoricalGame } from '../../src/types/real';

const g = (over: Partial<HistoricalGame>): HistoricalGame => ({
  id: 'x', playerId: 'p', playerName: 'P', sport: 'NFL', team: 'T', season: '2019', date: '2019-10-05', rating: 8, baseRax: 100, ...over,
});

describe('OTD yield + optimizer', () => {
  it('final yield = baseRax × sport multiplier × tier multiplier', () => {
    expect(gameYield(g({ baseRax: 100 }), 'Mystic')).toBeCloseTo(320);
    expect(gameYield(g({ baseRax: 100 }), 'Common', { NFL: 1.5 } as any)).toBeCloseTo(150);
  });

  it('flags only the top 2 per sport per day', () => {
    const owned: OwnedCard[] = [1, 2, 3].map((i) => ({ playerName: `NFL${i}`, sport: 'NFL', season: '2019', rarity: 'Common' }));
    owned.push({ playerName: 'NBA1', sport: 'NBA', season: '2019', rarity: 'Epic' });
    const games = [
      g({ playerName: 'NFL1', baseRax: 50 }),
      g({ playerName: 'NFL2', baseRax: 300 }),
      g({ playerName: 'NFL3', baseRax: 200 }),
      g({ playerName: 'NBA1', sport: 'NBA', baseRax: 10 }),
      g({ playerName: 'NFL1', date: '2019-11-01', baseRax: 999 }), // different day — ignored
    ];
    const plan = planDay(owned, games, '10-05');
    const nfl = plan.bySport.NFL!;
    expect(nfl.map((r) => [r.card.playerName, r.claim])).toEqual([['NFL2', true], ['NFL3', true], ['NFL1', false]]);
    expect(plan.bySport.NBA![0].claim).toBe(true);
    expect(plan.claimableTotal).toBe(300 + 200 + 20);
    expect(plan.leftOnTable).toBe(50);
  });

  it('ignores games from a different season or player', () => {
    const owned: OwnedCard[] = [{ playerName: 'P', sport: 'NFL', season: '2018', rarity: 'Common' }];
    expect(planDay(owned, [g({})], '10-05').claimableTotal).toBe(0);
  });
});

describe('ROI, break-even, comparison', () => {
  const games = [
    g({ id: '1', date: '2019-01-10', baseRax: 100 }),
    g({ id: '2', date: '2019-06-10', baseRax: 200 }),
    g({ id: '3', date: '2019-12-10', baseRax: 300 }),
  ];
  it('remaining yield counts only upcoming anniversaries, × rarity', () => {
    const [roi] = cardRoi(games, 'Epic', '06-10');
    expect(roi.games).toBe(3);
    expect(roi.remainingGames).toBe(1);
    expect(roi.remainingYield).toBe(600); // 300 × 2.0
    expect(roi.annualYield).toBe(1200); // (100+200+300) × 2.0
    expect(roi.maxGame).toBe(600);
    expect(roi.medianGame).toBe(400);
  });
  it('days to break even = price / (annual / 365)', () => {
    expect(breakEvenDays(1200, 1200)).toBe(365);
    expect(breakEvenDays(600, 1200)).toBeCloseTo(182.5);
    expect(breakEvenDays(100, 0)).toBe(Infinity);
  });
  it('compares two cards', () => {
    const a = cardRoi(games, 'Common', '01-01')[0];
    const b = cardRoi([g({ playerName: 'Q', baseRax: 1000 })], 'Common', '01-01')[0];
    const c = compareCards(a, b);
    expect(c.winners).toEqual({ games: 'a', median: 'b', ceiling: 'b', annual: 'b' });
    expect(cardId(games[0])).toBe('NFL|P|2019');
  });
});

describe('games import', () => {
  it('parses CSV and reports bad rows', () => {
    const r = parseGamesInput('player,sport,team,season,date,rating,baseRax\nJosh Allen,nfl,BUF,2020,2020-10-05,8.5,300\n"Smith, J",NFL,X,2020,2020-13-45,5,10\nNobody,XYZ,,2020,2020-01-01,5,10\nLow,NFL,,2020,2020-01-02,11,10');
    expect(r.games).toHaveLength(1);
    expect(r.games[0]).toMatchObject({ playerName: 'Josh Allen', sport: 'NFL', baseRax: 300, season: '2020' });
    expect(r.errors).toHaveLength(3);
    expect(r.derivedBase).toBe(false);
  });
  it('derives baseRax when absent, and says so', () => {
    const r = parseGamesInput('player,sport,date,rating\nA,NBA,2021-02-03,7');
    expect(r.games[0].baseRax).toBe(70);
    expect(r.derivedBase).toBe(true);
  });
  it('parses JSON and rejects missing columns', () => {
    expect(parseGamesInput('[{"player":"A","sport":"UFC","date":"2021-02-03","rating":9,"baseRax":5}]').games).toHaveLength(1);
    expect(parseGamesInput('player,sport\nA,NFL').errors[0]).toMatch(/Missing required column/);
    expect(parseGamesInput('').errors).toHaveLength(1);
  });
});

describe('sample data engine', () => {
  const NOW = Date.UTC(2026, 9, 5, 15, 20);
  it('is deterministic within an hour', () => {
    expect(JSON.stringify(sampleSeries(NOW).slice(0, 3))).toBe(JSON.stringify(sampleSeries(NOW + 600_000).slice(0, 3)));
  });
  it('covers every sport and produces the real spike/fair-value shape', () => {
    const series = sampleSeries(NOW);
    expect(new Set(series.map((s) => s.sport)).size).toBe(8);
    const sum = summarizeMarket(series, NOW, sampleCatalysts(NOW), 'sample');
    expect(sum.source).toBe('sample');
    expect(sum.spikes.length).toBeGreaterThanOrEqual(3);
    expect(sum.spikes.length).toBeLessThan(series.length / 2);
    expect(sum.spikes.every((s) => s.z > 2)).toBe(true);
    expect(sum.model.slope).toBeGreaterThan(0);
    expect(sum.fair.some((p) => p.undervalued)).toBe(true);
    expect(sum.fair.filter((p) => p.undervalued).length).toBeLessThan(series.length / 3);
  });
  it('series stays compact: hourly 7d + daily to 30d', () => {
    for (const s of sampleSeries(NOW)) {
      expect(s.points.length).toBeGreaterThan(168);
      expect(s.points.length).toBeLessThan(200);
      for (const p of s.points) {
        expect(p.high).toBeGreaterThanOrEqual(p.low);
        expect(p.volume).toBeGreaterThanOrEqual(0);
      }
    }
    const s = sampleSeries(NOW)[0];
    for (const w of ['24h', '7d', '30d'] as const) expect(buildCandles(s, NOW, w).length).toBeGreaterThan(10);
  });
  it('auction sample obeys per-rating = bid / rating and has premium bidding wars', () => {
    const a = sampleAuctions(NOW);
    expect(a.bids.length).toBeGreaterThan(40);
    for (const b of a.bids) expect(b.perRatingPrice).toBeCloseTo(b.highestBidRax / b.cardRating, 6);
    const premiums = a.bids.map((b) => b.perRatingPrice / a.baselines[playerKey(b.sport, b.playerName)]);
    expect(Math.max(...premiums)).toBeGreaterThan(1.3);
    expect(a.bids.every((b) => b.bidderUsername.startsWith('sample_'))).toBe(true);
  });
  it('contenders are Mystic/Legendary only', () => {
    const c = sampleAuctions(NOW).contenders;
    expect(c.length).toBeGreaterThan(5);
    expect(c.every((x) => x.rarity === 'Mystic' || x.rarity === 'Legendary')).toBe(true);
  });
  it('includes the example player from the brief', () => {
    expect(samplePlayers().some((p) => p.name === 'Jaxon Smith-Njigba')).toBe(true);
  });
  it('OTD sample is big, valid and leap-day-free', () => {
    const games = sampleOtdGames();
    expect(games.length).toBeGreaterThan(8000);
    expect(games.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date.slice(5) !== '02-29')).toBe(true);
    expect(games.every((x) => x.rating >= 2 && x.rating <= 10 && x.baseRax > 0)).toBe(true);
  });
});

describe('quads', () => {
  it('has the payout tiers from the spec', () => {
    expect(QUAD_PAYOUTS.map((p) => p.raxPerTeammate)).toEqual([50, 100, 200]);
    expect(squadTotal(200)).toBe(800);
  });
  it('karma opportunity = polls × pace', () => {
    expect(karmaOpportunity({ pollsPerGame: 20, pace: 1.1 })).toBe(22);
  });
  it('reads polls: consensus vs contrarian', () => {
    const r = readPoll({ id: 'p', gameId: 'g', question: 'q', votes: 1, options: [{ label: 'A', pct: 72 }, { label: 'B', pct: 22 }, { label: 'C', pct: 6 }] });
    expect(r.kind).toBe('consensus');
    expect(r.leader.label).toBe('A');
    expect(r.contrarian?.label).toBe('B');
    expect(r.contrarianMultiple).toBeCloseTo(4.55);
    const s = readPoll({ id: 'p', gameId: 'g', question: 'q', votes: 1, options: [{ label: 'Y', pct: 50 }, { label: 'N', pct: 50 }] });
    expect(s.kind).toBe('split');
    expect(s.contrarian).toBeNull();
  });
  it('sample schedule is well-formed', () => {
    const { games, polls } = sampleQuads(Date.UTC(2026, 9, 5));
    expect(games.length).toBeGreaterThan(5);
    for (const p of polls) expect(p.options.reduce((a, o) => a + o.pct, 0)).toBe(100);
  });
});
