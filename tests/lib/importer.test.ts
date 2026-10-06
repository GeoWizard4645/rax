import { describe, expect, it } from 'vitest';
import { applyMapping, findRows, flatten, guessMapping, parsePasted } from '../../shared/importer';
import { computeBaselines, snapshotMedians } from '../../shared/baselines';
import { normalizeAuction } from '../../shared/auctions';

const NOW = Date.UTC(2026, 9, 5, 12);
const real = {
  success: true,
  data: {
    listings: [
      { id: 'a1', endsAt: new Date(NOW + 3600_000).toISOString(), card: { rating: 94, rarity: 'Mystic', player: { fullName: 'Josh Allen', sport: 'nfl' } }, highestBid: { amount: '2,400', bidder: { username: 'zed', id: 'u9' }, createdAt: NOW - 5000 } },
      { id: 'a2', endsAt: new Date(NOW - 3600_000).toISOString(), card: { rating: 80, rarity: 'rare', player: { fullName: 'Nobody', sport: 'quidditch' } }, highestBid: { amount: 100, bidder: { username: 'q' } } },
    ],
    cursor: 'x',
  },
};

describe('importer', () => {
  it('finds the list inside an arbitrary envelope', () => {
    const f = findRows(real);
    expect(f.path).toBe('data.listings');
    expect(f.rows).toHaveLength(2);
  });
  it('flattens nested keys', () => {
    expect(Object.keys(flatten(findRows(real).rows[0]))).toContain('card.player.fullName');
  });
  it('guesses a mapping for an unfamiliar nested schema', () => {
    const m = guessMapping(findRows(real).rows);
    expect(m.playerName).toEqual({ path: 'card.player.fullName' });
    expect(m.sport).toEqual({ path: 'card.player.sport' });
    expect(m.rarity).toEqual({ path: 'card.rarity' });
    expect(m.rating).toEqual({ path: 'card.rating' });
    expect(m.bid).toEqual({ path: 'highestBid.amount' });
    expect(m.bidder).toEqual({ path: 'highestBid.bidder.username' });
    expect(m.expiresAt).toEqual({ path: 'endsAt' });
  });
  it('applies it: parses "2,400", normalises sport/rarity, skips bad rows with reasons', () => {
    const rows = findRows(real).rows;
    const { bids, skipped } = applyMapping(rows, guessMapping(rows), NOW);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ playerName: 'Josh Allen', sport: 'NFL', rarity: 'Mystic', highestBidRax: 2400, bidderUsername: 'zed', bidderUserId: 'u9', status: 'active' });
    expect(bids[0].perRatingPrice).toBeCloseTo(2400 / 94);
    expect(skipped).toEqual([{ row: 2, reason: 'unknown sport "QUIDDITCH"' }]);
  });
  it('supports constants for unmapped fields and closed detection', () => {
    const rows = [{ n: 'A B', r: 90, b: 500, u: 'x', done: 'SOLD' }];
    const { bids } = applyMapping(rows, { playerName: { path: 'n' }, rating: { path: 'r' }, bid: { path: 'b' }, bidder: { path: 'u' }, status: { path: 'done' }, sport: { value: 'NBA' }, rarity: { value: 'epic' } }, NOW);
    expect(bids[0]).toMatchObject({ sport: 'NBA', rarity: 'Epic', status: 'closed' });
  });
  it('parsePasted tolerates a prefix, rejects junk', () => {
    expect('rows' in parsePasted('Response: ' + JSON.stringify([{ a: 1 }]))).toBe(true);
    expect(parsePasted('hello')).toEqual({ error: 'That does not look like JSON.' });
    expect('error' in parsePasted('{"a":')).toBe(true);
    expect(parsePasted('{"a":[1,2]}')).toEqual({ error: 'No list of records found in that JSON.' });
    expect(parsePasted('')).toEqual({ error: 'Paste a JSON response first.' });
  });
  it('does not leak or require tokens: only response bodies are parsed', () => {
    expect(JSON.stringify(applyMapping(findRows(real).rows, guessMapping(findRows(real).rows), NOW))).not.toMatch(/token|cookie|authorization/i);
  });
});

describe('baselines for imported snapshots', () => {
  const bid = (p: string, prp: number, rarity: any = 'Epic', sport: any = 'NFL') => normalizeAuction({ playerName: p, sport, rarity, rating: 100, highestBid: prp * 100, bidderUsername: 'b' }, NOW)!;
  it('uses a player\'s own earlier snapshots when present', () => {
    const bids = [bid('A One', 30)];
    const hist = [{ t: NOW - 2 * 86_400_000, med: { 'NFL:a-one': 20 } }, { t: NOW - 86_400_000, med: { 'NFL:a-one': 22 } }];
    const r = computeBaselines(bids, hist, NOW);
    expect(r.baselines['NFL:a-one']).toBe(21);
    expect(r.kinds['NFL:a-one']).toBe('history');
  });
  it('falls back to similar cards (≥4) and otherwise gives no baseline', () => {
    const peers = [bid('P1', 10), bid('P2', 12), bid('P3', 14), bid('P4', 16), bid('Solo', 99, 'Iconic')];
    const r = computeBaselines(peers, [], NOW);
    expect(r.kinds['NFL:p1']).toBe('peers');
    expect(r.baselines['NFL:p1']).toBe(13);
    expect(r.baselines['NFL:solo']).toBeUndefined();
  });
  it('ignores the current snapshot and anything older than 7 days', () => {
    const r = computeBaselines([bid('A One', 30)], [{ t: NOW - 8 * 86_400_000, med: { 'NFL:a-one': 5 } }, { t: NOW - 1000, med: { 'NFL:a-one': 99 } }], NOW);
    expect(r.baselines['NFL:a-one']).toBeUndefined();
    expect(snapshotMedians([bid('A One', 30), bid('A One', 10)])['NFL:a-one']).toBe(20);
  });
});
