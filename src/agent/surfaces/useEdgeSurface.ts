import type { MarketType, OddsEvent, OddsResponse, OddsSport } from '../../../shared/odds';
import type { BoardRow } from '../../components/tab9-edge/edgeLogic';
import type { EdgeState } from '../../components/tab9-edge/useEdgeState';
import { useAgentSurface } from '../useAgentSurface';

interface Args {
  s: EdgeState;
  set: (p: Partial<EdgeState>) => void;
  view: string;
  setView: (v: 'games' | 'board') => void;
  board: BoardRow[];
  odds: OddsResponse | null | undefined;
  nEntries: number;
  onSport: () => void;
  reload: () => void;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const label = (e: OddsEvent, type: MarketType, line: number | null) => `${e.away} @ ${e.home} ${type}${line != null ? ` ${line}` : ''}`;

/** Tab 9 (Edge / EV): what the assistant sees and may change. Parameter names: src/agent/catalog.ts. */
export function useEdgeSurface({ s, set, view, setView, board, odds, nEntries, onSport, reload }: Args) {
  useAgentSurface('edge', {
    summary: () => ({
      view, sport: s.sport, bankroll: s.bankroll, kellyFraction: s.fraction, devig: s.devig,
      rules: { rakePct: r1(s.rules.rake * 100), rakeBasis: s.rules.rakeBasis, model: s.rules.model, poolRax: s.rules.poolRax, minStake: s.rules.minStake, maxStake: s.rules.maxStake },
      gamesLoaded: odds?.events.length ?? null,
      oddsSources: odds?.sources.map((x) => `${x.source}:${x.ok ? 'ok' : 'down'}`),
      savedRealPercentEntries: nEntries,
      bestEv: board.slice(0, 5).map((r) => ({ market: label(r.event, r.type, r.line), side: r.side.label, realPct: r.eval.realPct, fairPct: r1(r.eval.fair * 100), evPct: r1(r.eval.ev), stakeRax: r.eval.stake })),
    }),
    params: {
      sport: { get: () => s.sport, set: (v) => { set({ sport: v as OddsSport }); onSport(); } },
      bankroll: { get: () => s.bankroll, set: (v) => set({ bankroll: v as number }) },
      kellyFraction: { get: () => s.fraction, set: (v) => set({ fraction: v as number }) },
      devig: { get: () => s.devig, set: (v) => set({ devig: v as EdgeState['devig'] }) },
      rakePct: { get: () => r1(s.rules.rake * 100), set: (v) => set({ rules: { ...s.rules, rake: (v as number) / 100 } }) },
      rakeBasis: { get: () => s.rules.rakeBasis, set: (v) => set({ rules: { ...s.rules, rakeBasis: v as EdgeState['rules']['rakeBasis'] } }) },
      model: { get: () => s.rules.model, set: (v) => set({ rules: { ...s.rules, model: v as EdgeState['rules']['model'] } }) },
      poolRax: { get: () => s.rules.poolRax ?? 0, set: (v) => set({ rules: { ...s.rules, poolRax: (v as number) > 0 ? (v as number) : null } }) },
      minStake: { get: () => s.rules.minStake ?? 0, set: (v) => set({ rules: { ...s.rules, minStake: (v as number) > 0 ? (v as number) : null } }) },
      maxStake: { get: () => s.rules.maxStake ?? 0, set: (v) => set({ rules: { ...s.rules, maxStake: (v as number) > 0 ? (v as number) : null } }) },
      view: { get: () => view, set: (v) => setView(v as 'games' | 'board') },
    },
    actions: { refresh: reload },
  });
}
