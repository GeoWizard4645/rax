import type { CardRow } from '../../../shared/otdEfficiency';
import type { OtdCardRecord, OtdSnapshot } from '../../../shared/otdSnapshot';
import { DEFAULT_STATE, type EffState, type Level } from '../../components/tab7-efficiency/model';
import { effParams, effSummary } from '../effParams';
import { useAgentSurface } from '../useAgentSurface';

interface Args {
  s: EffState;
  set: (p: Partial<EffState>) => void;
  view: string;
  setView: (v: never) => void;
  rows: CardRow[];
  levels: Map<string, Level>;
  days: number;
  snap: { data: OtdSnapshot | null; loading: boolean };
  all: OtdCardRecord[] | undefined;
  owned: ReadonlySet<string>;
}

/** Tab 7 (OTD Efficiency): what the assistant sees and may change. Parameter names: src/agent/catalog.ts. */
export function useEfficiencySurface({ s, set, view, setView, rows, levels, days, snap, all, owned }: Args) {
  useAgentSurface('efficiency', {
    summary: () => {
      const top = (key: 'windowEarn' | 'roi') =>
        [...rows].sort((a, b) => b[key] - a[key]).slice(0, 5).map((r) => ({
          card: `${r.card.name} ${r.card.seasonLabel}`, sport: r.card.sport, rarity: levels.get(r.card.id)?.key, windowEarnRax: Math.round(r.windowEarn), costRax: Math.round(r.price),
          returnX: Number.isFinite(r.roi) ? Math.round(r.roi * 100) / 100 : null, paybackDays: Number.isFinite(r.paybackDays) ? Math.round(r.paybackDays) : null,
        }));
      return {
        view, ...effSummary(s), windowDays: days, cardsConsidered: rows.length,
        dataset: snap.data ? `${snap.data.method}, ${snap.data.generatedAt.slice(0, 10)}` : snap.loading ? 'loading' : 'unavailable',
        ownedCardNames: [...owned].slice(0, 15).map((id) => all?.find((c) => c.id === id)).filter((c): c is OtdCardRecord => !!c).map((c) => `${c.name} ${c.seasonLabel} @${s.ownedLevels[c.id]}`),
        topByWindowEarnings: top('windowEarn'), topByReturnPerRax: top('roi'),
      };
    },
    params: { ...effParams(s, set), view: { get: () => view, set: (v) => setView(v as never) } },
    actions: { reset: () => set({ ...DEFAULT_STATE, method: s.method }) },
  });
}
