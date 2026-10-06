import { describe, expect, it } from 'vitest';
import {
  buildCandles, buildPitch, clampDiscount, detectSpike, fairValue, linearRegression, median, perRatingPrice,
  premiumPct, realDeepLink, realLink, stdev, targetPrice, zScore, RARITY_MULT,
} from '../../shared/formulas';
import type { PlayerSeries, SeriesPoint } from '../../src/types/market';

describe('Tab 2 formulas', () => {
  it('per-rating price = bid / rating', () => {
    expect(perRatingPrice(2400, 96)).toBe(25);
    expect(perRatingPrice(100, 0)).toBe(0);
  });

  it('target price = bid * (1 - discount%)', () => {
    expect(targetPrice(1000, 0)).toBe(1000);
    expect(targetPrice(1000, 25)).toBe(750);
    expect(targetPrice(1000, -30)).toBeCloseTo(1300); // 30% above the bid
    expect(targetPrice(1000, 70)).toBeCloseTo(300);
  });

  it('clamps the slider to +30% above … 70% off', () => {
    expect(clampDiscount(-99)).toBe(-30);
    expect(clampDiscount(99)).toBe(70);
    expect(targetPrice(1000, 200)).toBeCloseTo(300);
  });

  it('premium % vs the 7d median', () => {
    expect(premiumPct(30, 20)).toBeCloseTo(50);
    expect(premiumPct(10, 20)).toBeCloseTo(-50);
    expect(premiumPct(10, 0)).toBe(0);
  });

  it('builds the pitch text from the spec', () => {
    const t = buildPitch({ highestBid: 2400, playerName: 'Josh Allen', targetPrice: 2160, cardRating: 96 });
    expect(t).toBe("Saw your 2,400 Rax bid on Josh Allen. I will sell you mine right now for 2,160 Rax. That's a 22.50/1 price per rating. Drop an offer on my profile.");
  });

  it('builds both deep links', () => {
    expect(realLink('some user')).toBe('https://realapp.link/u/some%20user');
    expect(realDeepLink('u_123')).toBe('realapp://user/u_123/chat');
  });
});

describe('statistics', () => {
  it('median / stdev', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('zScore never divides by zero on a flat baseline', () => {
    expect(Number.isFinite(zScore(120, [100, 100, 100, 100]))).toBe(true);
    expect(zScore(120, [100, 100, 100, 100])).toBeGreaterThan(2);
  });

  it('linear regression recovers a known line', () => {
    const pts = [70, 80, 90, 100].map((x) => ({ x, y: 5 * x - 200 }));
    const r = linearRegression(pts);
    expect(r.slope).toBeCloseTo(5);
    expect(r.intercept).toBeCloseTo(-200);
    expect(r.r2).toBeCloseTo(1);
  });

  it('rarity multipliers match the spec', () => {
    expect(RARITY_MULT).toEqual({ Common: 1, Uncommon: 1.2, Rare: 1.6, Epic: 2, Legendary: 2.5, Mystic: 3.2, Iconic: 4 });
  });
});

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;
function series(volFn: (h: number) => number, bidFn: (h: number) => number = () => 100): PlayerSeries {
  const points: SeriesPoint[] = [];
  for (let h = 30 * 24; h >= 0; h--) {
    const bid = bidFn(h);
    points.push({ t: NOW - h * HOUR, volume: volFn(h), avgBid: bid, medPrp: bid / 90, open: bid, high: bid * 1.01, low: bid * 0.99, close: bid });
  }
  return { key: 'NFL:x', playerName: 'X', sport: 'NFL', rating: 90, rarity: 'Epic', points };
}

describe('velocity spike screen (> 2 SD above 7d baseline)', () => {
  const noisy = (h: number) => 4 + ((h * 7) % 3); // 4..6 per hour, mild variation by hour
  it('flags a volume spike', () => {
    const s = series((h) => (h < 24 ? noisy(h) * 4 : noisy(h)));
    const r = detectSpike(s, NOW, ['Game Tonight']);
    expect(r).not.toBeNull();
    expect(r!.volumeZ).toBeGreaterThan(2);
    expect(r!.catalysts).toEqual(['Game Tonight']);
  });
  it('flags an average-bid spike with flat volume', () => {
    const s = series(noisy, (h) => (h < 24 ? 160 : 100 + (h % 5)));
    const r = detectSpike(s, NOW);
    expect(r).not.toBeNull();
    expect(r!.avgBidZ).toBeGreaterThan(2);
  });
  it('ignores ordinary variation', () => {
    expect(detectSpike(series(noisy), NOW)).toBeNull();
  });
  it('needs enough baseline days', () => {
    const s = series(noisy);
    s.points = s.points.filter((p) => p.t > NOW - 3 * 24 * HOUR);
    expect(detectSpike(s, NOW)).toBeNull();
  });
});

describe('fair value index', () => {
  it('flags only the card well below the trendline', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, playerName: `P${i}`, sport: 'NFL' as const, rating: 70 + i, medianPrice: 10 * (70 + i) - 400 + (i % 2 ? 6 : -6) }));
    items.push({ key: 'cheap', playerName: 'Cheap', sport: 'NFL', rating: 90, medianPrice: 10 * 90 - 400 - 260 });
    const { points, regression } = fairValue(items);
    expect(regression.slope).toBeGreaterThan(5); // the cheap outlier drags an OLS line down a little
    const flagged = points.filter((p) => p.undervalued).map((p) => p.key);
    expect(flagged).toEqual(['cheap']);
    expect(points.find((p) => p.key === 'cheap')!.deviation).toBeLessThan(-0.15);
  });
});

describe('candles', () => {
  it('buckets by window and keeps OHLC semantics', () => {
    const s = series(() => 2, (h) => 100 + (h % 24));
    const c24 = buildCandles(s, NOW, '24h');
    expect(c24.length).toBe(24);
    const c7 = buildCandles(s, NOW, '7d');
    expect(c7.length).toBe(28);
    for (const c of c7) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.volume).toBe(12); // 6 hourly points × 2
    }
    const c30 = buildCandles(s, NOW, '30d');
    expect(c30.length).toBe(30);
    expect(c30.every((c, i, a) => i === 0 || c.t > a[i - 1].t)).toBe(true);
  });
});
