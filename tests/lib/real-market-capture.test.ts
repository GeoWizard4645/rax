import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { REAL_MARKET_SNIPPET, parseRealCapture, realMarketBookmarklet, saleKey, timeLeftSeconds } from '../../shared/realMarketCapture';

const fx = fs.readFileSync('tests/fixtures/real/capture_sample.json', 'utf8');

describe('parseRealCapture', () => {
  it('accepts a real capture (recorded from the live Real marketplace, 2026-10-11)', () => {
    const r = parseRealCapture(fx);
    expect(r.errors).toEqual([]);
    expect(r.dropped).toBe(0);
    expect(r.capture!.auctions).toHaveLength(9);
    expect(r.capture!.sales).toHaveLength(10);
    expect(r.capture!.stats[0]).toMatchObject({ name: 'Bijan Robinson', median: 80, medianPerRating: 31, totalSales: 529, premium: 2.15 });
  });
  it('drops malformed rows and rejects garbage', () => {
    const d = JSON.parse(fx);
    d.auctions.push({ player: 'x' }, { player: 'y', bid: 'a' });
    d.sales.push({ price: 1 });
    expect(parseRealCapture(JSON.stringify(d)).dropped).toBe(3);
    expect(parseRealCapture('nope').errors[0]).toMatch(/invalid JSON/);
    expect(parseRealCapture('{"v":1,"kind":"x"}').errors[0]).toMatch(/Unrecognised/);
  });
});

describe('helpers', () => {
  it('timeLeftSeconds', () => {
    expect([timeLeftSeconds('4h'), timeLeftSeconds('5d'), timeLeftSeconds('30m'), timeLeftSeconds('x')]).toEqual([14400, 432000, 1800, null]);
  });
  it('saleKey is stable', () => {
    const s = JSON.parse(fx).sales[0];
    expect(saleKey(s)).toBe('B. Robinson|#2073|2026-10-11T03:35:00.000Z|100');
  });
});

describe('recorder snippet', () => {
  it('is valid JS that only READS the page: no network, no clicks, no cookies', () => {
    expect(() => new Function(REAL_MARKET_SNIPPET)).not.toThrow();
    for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\.click\s*\(/, /document\.cookie/, /localStorage/, /Authorization/i, /rax\.vivaanshahani/]) expect(REAL_MARKET_SNIPPET).not.toMatch(bad);
    expect(() => new Function(decodeURIComponent(realMarketBookmarklet().slice(11)))).not.toThrow();
  });
});
