import { useEffect, useMemo, useState } from 'react';
import { fetchCardGames, fetchPlayerStats, fetchSeasons, searchRaxNames } from '../lib/raxClient';
import { useAsync } from '../lib/useAsync';
import { RAX_TO_SPORT, type PlayerStat, type RaxSeason } from '../../shared/rax';
import { norm, type RbSport } from '../../shared/rateboard';
import type { HistoricalGame, Sport } from '../types/real';

export interface CardRef {
  playerName: string;
  sport: Sport;
  season: string;
}

/** Full-season games for each card, fetched in small batches (and cached per card). Empty list when disabled. */
export function useCardGames(cards: CardRef[], enabled = true) {
  const key = cards.map((c) => `${c.sport}|${c.season}|${norm(c.playerName)}`).sort().join(';');
  return useAsync<HistoricalGame[]>(
    async () => {
      const out: HistoricalGame[] = [];
      for (let i = 0; i < cards.length; i += 6) {
        const batch = await Promise.all(cards.slice(i, i + 6).map((c) => fetchCardGames(c.sport, c.season, c.playerName).catch(() => [] as HistoricalGame[])));
        out.push(...batch.flat());
      }
      return out;
    },
    [key],
    enabled && cards.length > 0,
  );
}

/** Season labels collected per app sport, newest first (e.g. NFL → ["2026","2025",…]). */
export function useRaxSeasons(enabled = true) {
  const r = useAsync<RaxSeason[]>(() => fetchSeasons(), [], enabled);
  const bySport = useMemo(() => {
    const m: Partial<Record<Sport, string[]>> = {};
    for (const s of r.data ?? []) {
      const sp = RAX_TO_SPORT[s.sport];
      if (sp) (m[sp] ??= []).push(String(s.season));
    }
    for (const l of Object.values(m)) l!.sort().reverse();
    return m;
  }, [r.data]);
  return { ...r, bySport };
}

/** Debounced name suggestions from Rax (any season) for the card picker. */
export function useRaxNameSearch(sport: Sport, q: string, enabled: boolean): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || q.trim().length < 2) return setNames([]);
    const ctl = new AbortController();
    const t = setTimeout(() => searchRaxNames(sport, q, ctl.signal).then((n) => !ctl.signal.aborted && setNames(n)).catch(() => {}), 300);
    return () => (clearTimeout(t), ctl.abort());
  }, [sport, q, enabled]);
  return names;
}

/** Owners + season Rax per player for the sports Rateboard has stats for. Empty map until loaded or when none apply. */
export function usePlayerStats(sports: RbSport[]): Map<RbSport, Map<string, PlayerStat>> {
  const key = sports.join(',');
  const [m, setM] = useState<Map<RbSport, Map<string, PlayerStat>>>(new Map());
  useEffect(() => {
    let alive = true;
    void Promise.all(sports.map(async (s) => [s, await fetchPlayerStats(s)] as const)).then((e) => alive && setM(new Map(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}
