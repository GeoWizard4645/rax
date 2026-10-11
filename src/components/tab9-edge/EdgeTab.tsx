import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketType, OddsEvent, OddsSport } from '../../../shared/odds';
import { consensusFair } from '../../../shared/oddsConsensus';
import { useNow, useOdds } from '../../hooks/useOdds';
import { slug } from '../../lib/format';
import { Segmented } from '../ui/Segmented';
import BestBoard from './BestBoard';
import GamesView, { openId } from './GamesView';
import Guide, { type GuideExample } from './Guide';
import type { EditorValue } from './MarketEditor';
import RulesPanel from './RulesPanel';
import SettingsBar from './SettingsBar';
import { buildBoard, putEntry, sportsWithEntries, type BoardRow, type Cfg } from './edgeLogic';
import { useEdgeState } from './useEdgeState';

type View = 'games' | 'board';

export default function EdgeTab() {
  const { s, set, setEntries } = useEdgeState();
  const [view, setView] = useState<View>('games');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const scrollTo = useRef<string | null>(null);

  const entrySports = useMemo(() => sportsWithEntries(s.entries), [s.entries]);
  const sports = useMemo(() => [...new Set<OddsSport>([s.sport, ...entrySports])], [s.sport, entrySports]);
  const { bySport, reload } = useOdds(sports, s.sport);
  const now = useNow(5_000);

  const cfg: Cfg = useMemo(() => ({ rules: s.rules, bankroll: s.bankroll, fraction: s.fraction, devig: s.devig }), [s.rules, s.bankroll, s.fraction, s.devig]);

  const onSave = useCallback(
    (e: OddsEvent, type: MarketType, line: number | null, v: EditorValue) => setEntries((st) => putEntry(st, e, type, line, v)),
    [setEntries],
  );

  const allEvents = useMemo(() => Object.values(bySport).flatMap((x) => x.data?.events ?? []), [bySport]);
  const board = useMemo(() => buildBoard(allEvents, s.entries, cfg), [allEvents, s.entries, cfg]);
  const loadedSports = useMemo(() => new Set(Object.entries(bySport).filter(([, x]) => x.data).map(([k]) => k)), [bySport]);
  const loadingSports = entrySports.some((sp) => !loadedSports.has(sp));
  const unmatchedKeys = useMemo(() => Object.entries(s.entries).filter(([k, e]) => !board.used.has(k) && loadedSports.has(e.sport)).map(([k]) => k), [s.entries, board.used, loadedSports]);

  const example: GuideExample | null = useMemo(() => {
    const evs = (bySport[s.sport]?.data?.events ?? []).filter((e) => e.markets.some((m) => m.type === 'moneyline'));
    for (const e of [...evs].sort((a, b) => b.markets.length - a.markets.length)) {
      const c = consensusFair(e, 'moneyline', null, s.devig);
      if (c.fair && c.sources.length >= 2 && !c.draw) return { label: `${e.home} to win (${e.away} @ ${e.home})`, fair: c.fair[0] };
    }
    return null;
  }, [bySport, s.sport, s.devig]);

  const openFromBoard = (r: BoardRow) => {
    scrollTo.current = `edge-${slug(openId(r.event, r.type))}`;
    set({ sport: r.event.sport });
    setView('games');
    setOpenKey(openId(r.event, r.type));
  };
  useEffect(() => {
    if (view !== 'games' || !scrollTo.current) return;
    const id = scrollTo.current;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrollTo.current = null;
    }, 150);
    return () => clearTimeout(t);
  }, [view, openKey, bySport]);

  const nEntries = Object.keys(s.entries).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Edge / EV</h1>
        <p className="text-sm text-muted">
          No-vig fair probabilities from Kalshi, Polymarket and DraftKings (via ESPN) for every upcoming game — type the % Real shows and see the EV, edge and a Kelly stake.
        </p>
      </div>

      <Guide cfg={cfg} example={example} />

      <SettingsBar s={s} set={set} />
      <RulesPanel rules={s.rules} set={(rules) => set({ rules })} />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'games', label: 'Games' },
            { value: 'board', label: `Best EV${board.rows.length ? ` (${board.rows.length})` : ''}` },
          ]}
        />
        <span className="text-xs text-muted">
          {nEntries} saved Real % entr{nEntries === 1 ? 'y' : 'ies'} · stored in this browser only · expire 24 h after kick-off
        </span>
      </div>

      {view === 'games' ? (
        <GamesView
          sport={s.sport}
          onSport={(sp) => { set({ sport: sp }); setOpenKey(null); }}
          bySport={bySport}
          now={now}
          cfg={cfg}
          store={s.entries}
          onSave={onSave}
          openKey={openKey}
          setOpenKey={setOpenKey}
          onReload={() => reload(s.sport)}
        />
      ) : (
        <BestBoard
          rows={board.rows}
          unmatched={unmatchedKeys.length}
          loadingSports={loadingSports}
          onOpen={openFromBoard}
          onClearUnmatched={() => setEntries((st) => Object.fromEntries(Object.entries(st).filter(([k]) => !unmatchedKeys.includes(k))))}
        />
      )}

      <p className="hint">
        <b className="text-head">Not financial advice.</b> Fair probabilities are free public data (Kalshi, Polymarket, DraftKings lines embedded in ESPN) and can be stale or thin; FanDuel has no public API and is not used. Real’s own market % can’t be fetched (login-gated, and predictions are Real Pro only), so every EV below depends on the % you type and on the rake assumption. Unofficial tool, not affiliated with Real.
      </p>
    </div>
  );
}
