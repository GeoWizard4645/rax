/** Assistant bindings for the lighter tabs (Rateboard, Scout, Volatility, Portfolio, Quads). Parameter names: src/agent/catalog.ts. */
import { liveOffers, type RbBoard, type RbSport } from '../../../shared/rateboard';
import type { FairValuePoint } from '../../types/market';
import { useAgentSurface } from '../useAgentSurface';

const r1 = (x: number) => Math.round(x * 10) / 10;

export function useRateboardSurface(a: { sport: RbSport; setSport: (s: RbSport) => void; mode: 'buy' | 'sell'; setMode: (m: 'buy' | 'sell') => void; board: RbBoard | null; me: string | null; refresh: () => void; hidden: boolean }) {
  useAgentSurface('rateboard', {
    summary: () => {
      const offers = a.board ? liveOffers(a.board, a.sport) : [];
      return {
        sport: a.sport, mode: a.mode, signedInAs: a.me ?? null, boardLoaded: !!a.board, liveOffersForSport: offers.length,
        bestOffers: offers.slice(0, 6).map((o) => ({ player: o.player, rate: o.rate })), floorRate: 8,
      };
    },
    params: {
      sport: { get: () => a.sport, set: (v) => a.setSport(v as RbSport) },
      mode: { get: () => a.mode, set: (v) => { if (!a.me) throw new Error('Sign in to Rateboard first — buy/sell modes only exist for signed-in users.'); a.setMode(v as 'buy' | 'sell'); } },
    },
    actions: { refresh: a.refresh },
  });
}

export function useScoutSurface(a: {
  username: string; setUsername: (u: string) => void; view: string; setView: (v: never) => void; discount: number; setDiscount: (d: number) => void;
  stats: { active: number; hot: number; top: number; contenders: number } | null; source?: string; imported: boolean; matches: number; pulling: string | null; collectionsLoaded: string[];
  submit: () => void; reload: () => void;
}) {
  useAgentSurface('scout', {
    summary: () => ({
      view: a.view, username: a.username || null, discount: a.discount, dataSource: a.source ?? 'loading', importedSnapshot: a.imported, pullingCollection: a.pulling,
      collectionsLoaded: a.collectionsLoaded, biddersOnYourCards: a.matches,
      headline: a.stats ? { liveAuctions: a.stats.active, biddingWars: a.stats.hot, topPremiumPct: Math.round(a.stats.top), repeatContenders: a.stats.contenders } : null,
    }),
    params: {
      username: { get: () => a.username, set: (v) => a.setUsername(v as string) },
      view: { get: () => a.view, set: (v) => a.setView(v as never) },
      discount: { get: () => a.discount, set: (v) => a.setDiscount(v as number) },
    },
    actions: {
      scout_my_cards: () => {
        if (!a.username.trim()) throw new Error('Set the username first.');
        a.submit();
        return 'Pulling the collection — it takes up to ~10 s per sport.';
      },
      refresh: a.reload,
    },
  });
}

interface PlayerLike {
  key: string;
  playerName: string;
  sport: string;
  rating: number | null;
  rarity: string | null;
}

export function useVolatilitySurface(a: {
  source: string; setSource: (s: never) => void; availableSources: string[];
  sport: string; setSport: (s: never) => void; allowedSports: readonly string[];
  players: PlayerLike[]; selected: string | null; setSelected: (k: string) => void;
  spikes: Array<{ playerName: string; z: number }>; fair: FairValuePoint[]; dataSource?: string; slope?: number; r2?: number; historyDays?: number | null;
}) {
  useAgentSurface('volatility', {
    summary: () => {
      const p = a.players.find((x) => x.key === a.selected);
      return {
        source: a.source, sport: a.sport, dataSource: a.dataSource ?? 'loading', rateHistoryDaysRecorded: a.historyDays != null ? r1(a.historyDays) : undefined, cardsTracked: a.players.length,
        selectedPlayer: p ? `${p.playerName} — ${p.sport}${p.rating != null ? ` ${p.rating}` : ''}${p.rarity ? ` ${p.rarity}` : ''}` : null,
        velocitySpikes: a.spikes.length, topSpikes: a.spikes.slice(0, 3).map((s) => `${s.playerName} (z ${r1(s.z)})`),
        buyAlerts: a.fair.filter((f) => f.undervalued).length, marketValuePerRatingPoint: a.slope !== undefined ? `${r1(a.slope)} Rax (R² ${a.r2?.toFixed(2)})` : undefined,
      };
    },
    params: {
      source: {
        get: () => a.source,
        set: (v) => {
          if (!a.availableSources.includes(String(v))) throw new Error(`The “${String(v)}” data source isn’t available (${a.availableSources.join(', ')} are).`);
          a.setSource(v as never);
        },
      },
      sport: {
        get: () => a.sport,
        set: (v) => {
          if (v !== 'ALL' && !a.allowedSports.includes(String(v))) throw new Error(`With the ${a.source} source the sport must be ALL or one of ${a.allowedSports.join(', ')}.`);
          a.setSport(v as never);
        },
      },
      player: {
        get: () => a.players.find((x) => x.key === a.selected)?.playerName ?? '',
        set: (v) => {
          const q = String(v).toLowerCase();
          const hit = a.players.find((p) => p.playerName.toLowerCase() === q) ?? a.players.find((p) => p.playerName.toLowerCase().includes(q));
          if (!hit) throw new Error(`No tracked player matches “${String(v)}” in the current filter.`);
          a.setSelected(hit.key);
        },
      },
    },
  });
}

export function usePortfolioSurface(a: { view: string; setView: (v: never) => void; auditRows: number }) {
  useAgentSurface('portfolio', {
    summary: () => ({ view: a.view, auditRowsSaved: a.auditRows }),
    params: { view: { get: () => a.view, set: (v) => a.setView(v as never) } },
  });
}

export function useQuadsSurface(a: {
  view: string; setView: (v: never) => void; games: Array<{ id: string; away: string; home: string; sport: string; marquee: boolean; startsAt: string }>; gameId: string | null; setPicked: (id: string) => void; source?: string; squad: number;
}) {
  useAgentSurface('quads', {
    summary: () => {
      const g = a.games.find((x) => x.id === a.gameId);
      return {
        view: a.view, scheduleSource: a.source ?? 'loading', upcomingGames: a.games.length, selectedGame: g ? `${g.away} @ ${g.home} (${g.sport}, ${g.startsAt})` : null,
        marqueeGames: a.games.filter((x) => x.marquee).slice(0, 5).map((x) => `${x.away} @ ${x.home}`), squadBoardEntries: a.squad,
      };
    },
    params: {
      view: { get: () => a.view, set: (v) => a.setView(v as never) },
      game: {
        get: () => { const g = a.games.find((x) => x.id === a.gameId); return g ? `${g.away} @ ${g.home}` : ''; },
        set: (v) => {
          const q = String(v).toLowerCase();
          const hit = a.games.find((g) => `${g.away} ${g.home}`.toLowerCase().includes(q));
          if (!hit) throw new Error(`No upcoming game matches “${String(v)}”.`);
          a.setPicked(hit.id);
        },
      },
    },
  });
}
