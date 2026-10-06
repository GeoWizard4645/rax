import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_SPORT_MULT } from '../../shared/formulas';
import { parseGamesInput, toMonthDay, type SportMult } from '../../shared/otd';
import { sampleOtdGames } from '../../shared/sample';
import { load, remove, save } from '../lib/storage';
import type { HistoricalGame } from '../types/real';

const GAMES_KEY = 'rax_otd_games_v1';
const MULT_KEY = 'rax_otd_sport_mult_v1';

/** MM-DD for the user's local calendar day. */
export const localMonthDay = (d = new Date()) => toMonthDay(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));

/**
 * The OTD historical games database. Starts as SAMPLE data; importing a CSV/JSON replaces it (kept in this
 * browser's storage). Sport multipliers are user-editable because the spec gives none.
 */
export function useOTDCalendar() {
  const [imported, setImported] = useState<HistoricalGame[] | null>(() => load<HistoricalGame[] | null>(GAMES_KEY, null));
  const [sportMult, setSportMultState] = useState<SportMult>(() => ({ ...DEFAULT_SPORT_MULT, ...load<Partial<SportMult>>(MULT_KEY, {}) }));
  const [derivedBase, setDerivedBase] = useState(false);
  const sample = useMemo(() => sampleOtdGames(), []);

  const importGames = useCallback((text: string) => {
    const r = parseGamesInput(text);
    if (r.games.length) {
      setImported(r.games);
      setDerivedBase(r.derivedBase);
      const stored = save(GAMES_KEY, r.games);
      if (!stored) r.errors.push('Imported for this session, but the dataset is too large to keep in browser storage.');
    }
    return r;
  }, []);

  const resetToSample = useCallback(() => {
    setImported(null);
    setDerivedBase(false);
    remove(GAMES_KEY);
  }, []);

  const setSportMult = useCallback((s: SportMult) => {
    setSportMultState(s);
    save(MULT_KEY, s);
  }, []);

  const games = imported ?? sample;
  return { games, source: imported ? ('imported' as const) : ('sample' as const), derivedBase, importGames, resetToSample, sportMult, setSportMult };
}
