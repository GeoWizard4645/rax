import { describe, expect, it } from 'vitest';
import { buildDemand } from '../../shared/demand';
import { blankBoard, type RbBoard } from '../../shared/rateboard';
import { findFighter, indexFighters, ufcStatus } from '../../shared/ufc';

const NOW = Date.UTC(2026, 9, 7, 15, 0, 0);
const H = 3_600_000;
const D = 24 * H;

const board = (): RbBoard => ({
  ...blankBoard(),
  users: { ann: { name: 'Ann', hasPassword: true }, bob: { name: 'Bob', hasPassword: true }, bad: { name: 'Bad', hasPassword: true, banned: true } },
  offers: [
    { id: '1', user: 'ann', sport: 'NFL', player: 'Josh Allen', rate: 30, link: 'x', ts: NOW - 2 * H },
    { id: '2', user: 'bob', sport: 'NFL', player: 'Josh Allen', rate: 20, link: 'x', ts: NOW - 3 * D },
    { id: '3', user: 'bad', sport: 'NFL', player: 'Josh Allen', rate: 99, link: 'x', ts: NOW - H },
    { id: '4', user: 'ann', sport: 'UFC', player: 'Jon Jones', rate: 15, link: 'x', ts: NOW - 20 * D },
  ],
  minimums: [{ sport: 'NFL', player: 'Josh Allen', rate: 25 }],
  keeplist: [{ sport: 'NFL', player: 'Josh Allen', rank: 3 }],
  house: [{ sport: 'UFC', player: 'Jon Jones', rate: 8 }],
});

describe('buildDemand', () => {
  it('rolls offers up per player, ignores banned users, and attaches floor / keep / house', () => {
    const d = buildDemand(board(), 'ALL', NOW);
    expect(d.liveOffers).toBe(3);
    expect(d.buyers).toBe(2);
    const allen = d.rows.find((r) => r.player === 'Josh Allen')!;
    expect(allen).toMatchObject({ buyers: 2, best: 30, median: 25, floor: 25, keepRank: 3, house: null, new24h: 1, new7d: 2 });
    expect(d.rows.find((r) => r.player === 'Jon Jones')).toMatchObject({ house: 8, new7d: 0, floor: null, keepRank: null });
    expect(d.rows[0].player).toBe('Josh Allen'); // hottest first
  });

  it('filters by sport and buckets new offers per UTC day', () => {
    const d = buildDemand(board(), 'NFL', NOW, 7);
    expect(d.rows).toHaveLength(1);
    expect(d.days).toHaveLength(7);
    expect(d.days[6].offers).toBe(1); // today
    expect(d.days[3].offers).toBe(1); // 3 days ago
    expect(d.days.reduce((n, x) => n + x.offers, 0)).toBe(2);
    expect(d.days[6].t).toBe(Date.UTC(2026, 9, 7));
  });

  it('copes with an empty board', () => {
    const d = buildDemand(blankBoard(), 'ALL', NOW);
    expect(d).toMatchObject({ rows: [], liveOffers: 0, buyers: 0, new24h: 0 });
  });
});

describe('ufc', () => {
  it('normalises localised status strings', () => {
    expect(ufcStatus('Active')).toBe('active');
    expect(ufcStatus('Aktiv')).toBe('active');
    expect(ufcStatus('Im Ruhestand')).toBe('retired');
    expect(ufcStatus('Nicht kämpfen')).toBe('inactive');
    expect(ufcStatus('')).toBe('unknown');
  });
  it('finds a fighter by normalised name', () => {
    const idx = indexFighters({ fighters: { "Sean O'Malley": { status: 'Active', age: '31', record: '18-2-0', division: 'Bantamweight Division', lastFight: '2026-01-01', nextFight: '' } } });
    expect(findFighter(idx, "sean o'malley")?.record).toBe('18-2-0');
    expect(findFighter(idx, 'Nobody')).toBeNull();
  });
});

import { bestOfferFor } from '../../shared/rateboard';

describe('bestOfferFor', () => {
  it('prefers the house rate, otherwise the top live offer, ignoring banned buyers', () => {
    const b = board();
    expect(bestOfferFor(b, 'UFC', 'Jon Jones')).toMatchObject({ rate: 8, house: true });
    expect(bestOfferFor(b, 'NFL', 'Josh Allen')).toMatchObject({ rate: 30, buyer: 'Ann', house: false }); // banned 99 ignored
    expect(bestOfferFor(b, 'NFL', 'Nobody Here')).toBeNull();
  });
});
