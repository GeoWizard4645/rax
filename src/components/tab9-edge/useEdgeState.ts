import { useCallback, useEffect, useState } from 'react';
import type { OddsSport } from '../../../shared/odds';
import { ODDS_SPORTS } from '../../../shared/odds';
import type { DevigMethod } from '../../../shared/oddsConsensus';
import { DEFAULT_REAL_RULES, type RealRules } from '../../../shared/realPayout';
import { load, save } from '../../lib/storage';
import { pruneEntries, type EntryStore } from './edgeLogic';

const KEY = 'rax_edge_v1';

export interface EdgeState {
  sport: OddsSport;
  /** Rax. */
  bankroll: number;
  /** Kelly fraction (0.25 = quarter Kelly). */
  fraction: number;
  devig: DevigMethod;
  /** Editable Real payout rules; `maxStake` / `minStake` double as the user's own stake cap / floor. */
  rules: RealRules;
  /** Typed Real % per sport|date|home|away|market|line. */
  entries: EntryStore;
}

export const DEFAULT_EDGE: EdgeState = {
  sport: 'NFL',
  bankroll: 1000,
  fraction: 0.25,
  devig: 'proportional',
  rules: DEFAULT_REAL_RULES,
  entries: {},
};

const num = (x: unknown, fb: number, min = 0): number => (typeof x === 'number' && Number.isFinite(x) && x >= min ? x : fb);

/** Defensive read: a hand-edited or older blob never crashes the tab. */
function read(): EdgeState {
  const raw = load<Partial<EdgeState>>(KEY, {});
  const r = (raw.rules ?? {}) as Partial<RealRules>;
  const rules: RealRules = {
    ...DEFAULT_REAL_RULES,
    ...r,
    rake: Math.min(0.5, num(r.rake, DEFAULT_REAL_RULES.rake)),
    rakeBasis: r.rakeBasis === 'profit' ? 'profit' : 'payout',
    model: r.model === 'pool' ? 'pool' : 'fixed',
    poolRax: r.poolRax != null && r.poolRax > 0 ? r.poolRax : null,
    minStake: r.minStake != null && r.minStake > 0 ? r.minStake : null,
    maxStake: r.maxStake != null && r.maxStake > 0 ? r.maxStake : null,
    stakeStep: num(r.stakeStep, 1, 1),
  };
  return {
    sport: ODDS_SPORTS.includes(raw.sport as OddsSport) ? (raw.sport as OddsSport) : DEFAULT_EDGE.sport,
    bankroll: num(raw.bankroll, DEFAULT_EDGE.bankroll),
    fraction: Math.min(1, Math.max(0.01, num(raw.fraction, DEFAULT_EDGE.fraction))),
    devig: raw.devig === 'power' ? 'power' : 'proportional',
    rules,
    entries: pruneEntries(raw.entries && typeof raw.entries === 'object' ? raw.entries : {}),
  };
}

/** Persisted Tab 9 state. Entries for games that started > 24 h ago are dropped on load and then hourly. */
export function useEdgeState() {
  const [s, setS] = useState<EdgeState>(read);
  const set = useCallback((p: Partial<EdgeState>) => setS((x) => ({ ...x, ...p })), []);
  const setEntries = useCallback((f: (e: EntryStore) => EntryStore) => setS((x) => ({ ...x, entries: f(x.entries) })), []);
  useEffect(() => void save(KEY, s), [s]);
  useEffect(() => {
    const t = setInterval(() => setS((x) => {
      const pruned = pruneEntries(x.entries);
      return Object.keys(pruned).length === Object.keys(x.entries).length ? x : { ...x, entries: pruned };
    }), 3600_000);
    return () => clearInterval(t);
  }, []);
  return { s, set, setEntries };
}
