import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { combineStores, communityCounts, communityLabel, communityLine, communityToStore, type CommunityData, type CommunitySummary } from '../../shared/communityMarket';
import { emptyStore, mergeCapture, radarItems } from '../../shared/realMarket';
import { parseRealCapture } from '../../shared/realMarketCapture';
import { COMBINE_KEY, ID_KEY, SHARE_KEY, VERIFIED_KEY, contributorId, getCombine, getShare, getVerifiedOnly } from '../../src/lib/communityStore';

const NOW = Date.parse('2026-10-11T18:00:00Z');
const cap = parseRealCapture(fs.readFileSync('tests/fixtures/real/capture_sample.json', 'utf8')).capture!;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

/** What GET /api/market/community would return for the fixture, as if `reports` people had reported every row. */
const asCommunity = (reports: number): CommunityData => ({
  fetchedAt: NOW,
  truncated: false,
  sales: cap.sales.map((s) => ({ sport: 'NFL', type: 'RUSH', player: s.player, serial: s.serial, rating: s.rating, rarity: s.rarity.toUpperCase(), price: s.price, perRating: s.perRating, at: s.at, outcome: s.outcome, reports })),
  auctions: cap.auctions.map((a) => ({ sport: a.sport, season: a.season, rarity: a.rarity, type: a.type, rating: a.rating, play: a.play, player: a.player, team: a.team, serial: a.serial, bid: a.bid, bids: a.bids, watchers: a.watchers, timeLeftSec: a.timeLeftSec, lastSeen: a.seenAt, reports, points: [[new Date(Date.parse(a.seenAt) - 3_600_000).toISOString(), a.bid - 10, 0]] as Array<[string, number, number]> })),
  stats: cap.stats.map((s) => ({ ...s, reports })),
});
const SUMMARY: CommunitySummary = { rows: { sales: 10, auctions: 9, stats: 1, total: 20 }, verified: { sales: 10, auctions: 9, stats: 0, exactAsOf: null }, contributors: 2, contributors30d: 2, lastContribution: '2026-10-11T17:55:00.000Z', bySport: {} };

describe('community data → the same structures as a local capture', () => {
  it('turns rows into a store the existing radar understands, and the verified filter really filters', () => {
    const verified = communityToStore(asCommunity(2), SUMMARY, 2);
    expect(verified.sales).toHaveLength(10);
    expect(verified.auctions).toHaveLength(9);
    expect(verified.stats).toHaveLength(1);
    expect(communityToStore(asCommunity(1), SUMMARY, 2)).toMatchObject({ sales: [], auctions: [], stats: [] });
    expect(communityToStore(asCommunity(1), SUMMARY, 1).sales).toHaveLength(10);
    expect(communityToStore(null, null, 2).sales).toEqual([]);
    const items = radarItems(verified, NOW);
    expect(items).toHaveLength(9);
    expect(items.every((i) => i.status.state !== undefined)).toBe(true);
    // an auction's earlier bid points survive, and the newest point carries the timer
    const bijan = verified.auctions.find((a) => a.player === 'BIJAN ROBINSON')!;
    expect(bijan.pts.length).toBeGreaterThanOrEqual(1);
    expect(bijan.pts[bijan.pts.length - 1]).toMatchObject({ bid: 110, timeLeftSec: 432000 });
  });

  it('a forged variant (same sale, other rating) collapses onto the better-corroborated row', () => {
    const d = asCommunity(2);
    d.sales.push({ ...d.sales[0], rating: 9, reports: 1 });
    const s = communityToStore(d, SUMMARY, 1);
    expect(s.sales).toHaveLength(10);
    expect(s.sales.find((x) => x.serial === d.sales[0].serial)!.rating).toBe(2.6);
  });
});

describe('combining community and local data without double counting', () => {
  const local = mergeCapture(emptyStore(), cap, NOW).store;

  it('the same capture on both sides counts each sale, auction and market view once', () => {
    const both = combineStores(local, communityToStore(asCommunity(2), SUMMARY, 2));
    expect(both.sales).toHaveLength(10);
    expect(both.auctions).toHaveLength(9);
    expect(both.stats).toHaveLength(1);
    // the community's older bid point and your own sighting are kept as history; the same instant is one point
    const bijan = both.auctions.find((a) => a.player === 'BIJAN ROBINSON')!;
    expect(bijan.pts.length).toBe(2);
  });

  it('disjoint data is simply the union', () => {
    const other = { ...asCommunity(2), sales: asCommunity(2).sales.map((s, i) => ({ ...s, serial: `#${9000 + i}` })) };
    expect(combineStores(local, communityToStore(other, SUMMARY, 2)).sales).toHaveLength(20);
  });

  it('with no local data the combination is the community store', () => {
    const c = communityToStore(asCommunity(2), SUMMARY, 2);
    expect(combineStores(emptyStore(), c).sales).toHaveLength(c.sales.length);
  });
});

describe('labels and counts', () => {
  it('every community number is labelled "Community database · N reporters · updated <age>"', () => {
    expect(communityLabel(SUMMARY, NOW)).toBe('Community database · 2 reporters · updated 5 min ago');
    expect(communityLabel({ ...SUMMARY, contributors: 1 }, NOW, true)).toBe('Community database + your capture · 1 reporter · updated 5 min ago');
    expect(communityLabel(null, NOW)).toBe('Community database · 0 reporters · updated never');
  });
  it('the public line and the default-selection counts', () => {
    expect(communityLine(SUMMARY, NOW)).toBe('Community data: 10 sales · 9 auctions · 1 market view · 2 reporters · updated 5 min ago');
    expect(communityLine({ ...SUMMARY, rows: { sales: 0, auctions: 0, stats: 0, total: 0 } }, NOW)).toMatch(/nothing shared yet/);
    expect(communityCounts(SUMMARY, true)).toEqual({ sales: 10, auctions: 9, stats: 0, total: 19 });
    expect(communityCounts(SUMMARY, false).total).toBe(20);
    expect(communityCounts(null, true).total).toBe(0);
  });
});

describe('settings and identity', () => {
  it('sharing is OFF by default; verified-only and combine are ON; the choices are remembered', () => {
    const s = mem();
    expect(getShare(s)).toBe(false);
    expect(getVerifiedOnly(s)).toBe(true);
    expect(getCombine(s)).toBe(true);
    s.setItem(SHARE_KEY, '1');
    s.setItem(VERIFIED_KEY, '0');
    s.setItem(COMBINE_KEY, '0');
    expect([getShare(s), getVerifiedOnly(s), getCombine(s)]).toEqual([true, false, false]);
    expect(getShare({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBe(false); // blocked storage → still off
  });
  it('the contributor id is 128 random bits, made once and reused', () => {
    const s = mem();
    const a = contributorId(s);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(contributorId(s)).toBe(a);
    expect(s.m.get(ID_KEY)).toBe(a);
    expect(contributorId(mem())).not.toBe(a);
  });
});
