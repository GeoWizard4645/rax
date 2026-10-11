/** Browser-side store for data imported from RaxEdge (see shared/raxedgeBridge.ts). Never leaves the browser. */
import { useEffect, useState } from 'react';
import type { RaxEdgeOddsExport, RaxEdgePackExport } from '../../shared/raxedgeBridge';

export interface RaxEdgeStored {
  odds: { at: string; plan?: string; data: RaxEdgeOddsExport } | null;
  packOdds: RaxEdgePackExport | null;
}

const KEYS = { odds: 'rax_re_odds_v1', packOdds: 'rax_re_pack_v1' } as const;
const EVT = 'rax-raxedge-change';

function read<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const loadRaxEdge = (): RaxEdgeStored => ({ odds: read(KEYS.odds), packOdds: read(KEYS.packOdds) });

/** Returns false when the browser refuses (quota, private mode) so the UI can say so. */
export function saveRaxEdge<K extends keyof RaxEdgeStored>(kind: K, value: NonNullable<RaxEdgeStored[K]>): boolean {
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(value));
    window.dispatchEvent(new Event(EVT));
    return true;
  } catch {
    return false;
  }
}

export function clearRaxEdge(kind: keyof RaxEdgeStored) {
  try {
    localStorage.removeItem(KEYS[kind]);
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* ignore */
  }
}

/** Live view of what's been imported; re-renders when any tab imports or clears something. */
export function useRaxEdge(): RaxEdgeStored {
  const [s, setS] = useState<RaxEdgeStored>(loadRaxEdge);
  useEffect(() => {
    const on = () => setS(loadRaxEdge());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return s;
}
