import { useCallback, useEffect, useState } from 'react';
import { load, save } from '../../lib/storage';
import { DEFAULT_STATE, type EffState } from './model';

const KEY = 'rax_eff_state_v1';

/** Shared, persisted state for Tabs 7 and 8, so the cards you own follow you between them. */
export function useEffState() {
  const [s, setS] = useState<EffState>(() => {
    const saved = load<Partial<EffState> & { owned?: unknown }>(KEY, {});
    delete saved.owned; // pre-ownedLevels shape
    return { ...DEFAULT_STATE, ...saved };
  });
  const set = useCallback((p: Partial<EffState>) => setS((x) => ({ ...x, ...p })), []);
  useEffect(() => void save(KEY, s), [s]);
  return { s, set, setS };
}
