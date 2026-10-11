import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { RAXEDGE_BRIDGE_SNIPPET, packRowsFrom, parseBridge, raxedgeBridgeBookmarklet } from '../../shared/raxedgeBridge';

const fx = (n: string) => JSON.parse(fs.readFileSync(`tests/fixtures/raxedge/${n}.json`, 'utf8'));

describe('parseBridge', () => {
  it('wraps a legacy v1 OTD export', () => {
    const r = parseBridge(JSON.stringify({ v: 1, user: 'a', at: 'x', passes: [] }));
    expect(r.bundle?.v).toBe(2);
    expect(r.bundle?.otd?.user).toBe('a');
  });
  it('accepts v2 and rejects garbage', () => {
    expect(parseBridge('{"v":2,"kind":"rax-bridge","at":"t","packOdds":{"at":1,"players":[]}}').bundle?.packOdds).toBeTruthy();
    expect(parseBridge('nope').errors[0]).toMatch(/invalid JSON/);
    expect(parseBridge('{"v":3}').errors[0]).toMatch(/Unrecognised/);
  });
});

describe('packRowsFrom', () => {
  it('compacts RaxEdge pack-odds rows', () => {
    const rows = packRowsFrom(fx('pack_odds'));
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r[3] === 'Saquon Barkley')).toEqual(['nfl', '2023', '19766', 'Saquon Barkley', 'RB', 3.73, 37, 41.19, 0, 58.81]);
    expect(packRowsFrom({ nope: 1 })).toEqual([]);
  });
});

describe('export snippet', () => {
  it('is valid JavaScript that only calls raxedge.com routes and puts the result on the clipboard', () => {
    expect(() => new Function(RAXEDGE_BRIDGE_SNIPPET)).not.toThrow();
    expect(RAXEDGE_BRIDGE_SNIPPET).not.toMatch(/fetch\(['"`]https?:/);
    expect(RAXEDGE_BRIDGE_SNIPPET).not.toMatch(/rax\.vivaanshahani|XMLHttpRequest|sendBeacon|WebSocket/);
    const routes = [...RAXEDGE_BRIDGE_SNIPPET.matchAll(/'(\/api\/[^'+]*)/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(8);
    expect(routes.every((r) => r.startsWith('/api/'))).toBe(true);
    expect(() => new Function(decodeURIComponent(raxedgeBridgeBookmarklet().slice(11)))).not.toThrow();
  });
});
