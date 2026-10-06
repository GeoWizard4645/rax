import { useCallback, useRef, useState } from 'react';
import { ApiError, getJson } from '../lib/api';
import { pullCollection, type PullProgress } from '../lib/rateboardClient';
import type { RbSport } from '../../shared/rateboard';
import type { CollectionPlayer, RealUserProfile } from '../types/real';

export type ProfileStatus = 'idle' | 'loading' | 'ok' | 'unconfigured' | 'not_found' | 'error';

/**
 * Best-effort mapping of a Real profile payload. The exact schema couldn't be verified, so this accepts
 * several common spellings and leaves anything it can't find as null (the UI shows "—").
 */
export function normalizeProfile(username: string, raw: any): RealUserProfile {
  const p = raw?.user ?? raw?.profile ?? raw ?? {};
  const num = (...v: unknown[]) => {
    for (const x of v) if (typeof x === 'number' && Number.isFinite(x)) return x;
    return null;
  };
  const badges = Array.isArray(p.badges) ? p.badges.map((b: any) => (typeof b === 'string' ? b : b?.name ?? b?.title)).filter(Boolean) : [];
  return {
    username: String(p.username ?? p.handle ?? username),
    userId: p.id != null ? String(p.id) : p.userId != null ? String(p.userId) : undefined,
    avatarUrl: p.profilePicture ?? p.avatarUrl ?? p.avatar ?? p.imageUrl ?? null,
    badges,
    karma: num(p.karma, p.totalKarma),
    raxBalance: num(p.raxBalance, p.rax, p.balance),
    cardCount: num(p.cardCount, p.cardsOwned, p.totalCards),
  };
}

/** Looks a Real user up: profile header via the edge proxy (when configured) + per-sport collections via Rateboard's pull. */
export function useRealUser() {
  const [username, setUsername] = useState('');
  const [profile, setProfile] = useState<RealUserProfile | null>(null);
  const [status, setStatus] = useState<ProfileStatus>('idle');
  const [collections, setCollections] = useState<Partial<Record<RbSport, CollectionPlayer[]>>>({});
  const [pulling, setPulling] = useState<RbSport | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const ensureSport = useCallback(
    async (sport: RbSport, user = username) => {
      if (!user) return;
      const g = gen.current;
      setPulling(sport);
      setError(null);
      try {
        const players = await pullCollection(user, sport, setProgress);
        if (g === gen.current) setCollections((c) => ({ ...c, [sport]: players }));
      } catch (e) {
        if (g === gen.current) setError((e as Error).message);
      } finally {
        if (g === gen.current) {
          setPulling(null);
          setProgress(null);
        }
      }
    },
    [username],
  );

  const lookup = useCallback(
    async (name: string, sport: RbSport) => {
      const u = name.trim();
      if (!u) return;
      gen.current++;
      const g = gen.current;
      setUsername(u);
      setProfile(null);
      setCollections({});
      setError(null);
      setStatus('loading');
      // Profile header (optional) and the collection run in parallel.
      const profileP = getJson<unknown>(`/api/proxy/real?endpoint=${encodeURIComponent(`v1/users/${u}/profile`)}`)
        .then((raw) => {
          if (g !== gen.current) return;
          setProfile(normalizeProfile(u, raw));
          setStatus('ok');
        })
        .catch((e: ApiError) => {
          if (g !== gen.current) return;
          setStatus(e.code === 'upstream_not_configured' ? 'unconfigured' : e.status === 404 ? 'not_found' : 'error');
        });
      await Promise.all([profileP, ensureSport(sport, u)]);
    },
    [ensureSport],
  );

  return { username, profile, status, collections, pulling, progress, error, lookup, ensureSport };
}

/** Lightweight multi-sport collection loader (no profile call) — used by Tabs 2 and 5. */
export function useCollections() {
  const [username, setUsername] = useState('');
  const [collections, setCollections] = useState<Partial<Record<RbSport, CollectionPlayer[]>>>({});
  const [pulling, setPulling] = useState<RbSport | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [errors, setErrors] = useState<Partial<Record<RbSport, string>>>({});
  const gen = useRef(0);

  const load = useCallback(async (name: string, sports: RbSport[]) => {
    const u = name.trim();
    if (!u) return;
    gen.current++;
    const g = gen.current;
    setUsername(u);
    setCollections({});
    setErrors({});
    for (const sport of sports) {
      if (g !== gen.current) return;
      setPulling(sport);
      try {
        const players = await pullCollection(u, sport, setProgress);
        if (g === gen.current) setCollections((c) => ({ ...c, [sport]: players }));
      } catch (e) {
        if (g === gen.current) setErrors((x) => ({ ...x, [sport]: (e as Error).message }));
        // an unknown username will fail every sport the same way — stop early
        if (/not found/i.test((e as Error).message)) break;
      }
    }
    if (g === gen.current) {
      setPulling(null);
      setProgress(null);
    }
  }, []);

  const clear = useCallback(() => {
    gen.current++;
    setUsername('');
    setCollections({});
    setErrors({});
    setPulling(null);
  }, []);

  return { username, collections, pulling, progress, errors, load, clear };
}
