import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { ODDS_SOURCE_LABEL, ODDS_SPORTS, type OddsEvent, type OddsSource, type OddsSport } from '../../../shared/odds';
import type { RealPctSuggestion } from '../../../shared/oddsRaxEdge';
import type { SportOdds } from '../../hooks/useOdds';
import { slug } from '../../lib/format';
import { Loading } from '../ui/StateBlock';
import MarketRow, { RowHeader, SOURCE_ORDER } from './MarketRow';
import type { EditorValue } from './MarketEditor';
import {
  dayKey,
  dayLabel,
  emptyReason,
  findAuto,
  linesOf,
  lookupEntry,
  marketTypes,
  matchesSearch,
  sourceState,
  startText,
  type Cfg,
  type EntryStore,
  type SourceState,
} from './edgeLogic';
import type { MarketType } from '../../../shared/odds';

export const openId = (e: OddsEvent, type: MarketType) => `${e.sport}|${e.startsAt.slice(0, 10)}|${slug(e.home)}|${slug(e.away)}|${type}`;
export const anchorOf = (e: OddsEvent, type: MarketType) => `edge-${slug(openId(e, type))}`;

const STATE_UI: Record<SourceState, { cls: string; text: string }> = {
  ok: { cls: 'chip-emerald', text: 'ok' },
  partial: { cls: 'chip-amber', text: 'partial' },
  error: { cls: 'chip-amber !border-danger/50 !bg-danger/10 !text-danger', text: 'error' },
  empty: { cls: 'chip-muted', text: 'no markets' },
  skipped: { cls: 'chip-muted', text: 'n/a' },
};

const chipLabel = (s: OddsSource) => (s === 'draftkings' ? 'DK · RaxEdge' : s === 'fanduel' ? 'FanDuel · RaxEdge' : ODDS_SOURCE_LABEL[s].replace(' (via ESPN)', ''));

/** Per-source status chips (ok / error / no markets), last-updated and refresh. */
export function StatusBar({ st, now, onReload, sport }: { st: SportOdds; now: number; onReload: () => void; sport: OddsSport }) {
  const ago = st.fetchedAt ? Math.max(0, Math.round((now - st.fetchedAt) / 1000)) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
      <span className="uppercase tracking-wider">Sources</span>
      {(st.data?.sources ?? []).map((s) => {
        const u = STATE_UI[sourceState(s)];
        return (
          <span key={s.source} className={u.cls} title={s.error ?? `${s.count} market${s.count === 1 ? '' : 's'}`}>
            {chipLabel(s.source)} · {u.text}
            {sourceState(s) === 'ok' || sourceState(s) === 'partial' ? <span className="num"> · {s.count}</span> : null}
          </span>
        );
      })}
      {!st.data && !st.error && <span>loading…</span>}
      <span className="ml-auto flex items-center gap-2">
        {st.error && <span className="text-danger" role="alert">{st.data ? 'Refresh failed — showing the last data. ' : ''}{st.error}</span>}
        <span className="num" title={st.data ? `Server snapshot ${new Date(st.data.generatedAt).toLocaleTimeString()}` : undefined}>
          {ago == null ? 'not loaded yet' : `updated ${ago < 5 ? 'just now' : `${ago}s ago`}`} · auto-refresh 60 s
        </span>
        <button className="btn-ghost btn-sm" onClick={onReload} disabled={st.loading} aria-label={`Refresh ${sport} odds`}>
          <RefreshCw size={12} className={st.loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </span>
    </div>
  );
}

export default function GamesView({
  sport,
  onSport,
  bySport,
  now,
  cfg,
  store,
  onSave,
  openKey,
  setOpenKey,
  onReload,
  cols = SOURCE_ORDER,
  suggestions = [],
}: {
  sport: OddsSport;
  onSport: (s: OddsSport) => void;
  bySport: Record<string, SportOdds>;
  now: number;
  cfg: Cfg;
  store: EntryStore;
  onSave: (e: OddsEvent, type: MarketType, line: number | null, v: EditorValue) => void;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  onReload: () => void;
  /** Source columns to show (adds FanDuel / DraftKings when the user switched them on). */
  cols?: OddsSource[];
  /** Real's own market % from the user's RaxEdge export; empty unless the auto-fill option is on. */
  suggestions?: RealPctSuggestion[];
}) {
  const st = bySport[sport] ?? { data: null, error: null, loading: true, fetchedAt: null };
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState<'all' | MarketType>('all');
  const [lineSel, setLineSel] = useState<Record<string, number>>({});

  const events = useMemo(() => {
    const ev = (st.data?.events ?? []).filter((e) => matchesSearch(e, q) && e.status !== 'final');
    return [...ev].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [st.data, q]);
  const groups = useMemo(() => {
    const m = new Map<string, OddsEvent[]>();
    for (const e of events) m.set(dayKey(e), [...(m.get(dayKey(e)) ?? []), e]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const total = st.data?.events.length ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sport">
          {ODDS_SPORTS.map((s) => {
            const n = bySport[s]?.data?.events.length;
            const mine = Object.values(store).filter((e) => e.sport === s).length;
            return (
              <button
                key={s}
                role="tab"
                aria-selected={sport === s}
                onClick={() => onSport(s)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors ${sport === s ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:bg-hover hover:text-head'}`}
              >
                {s}
                {n != null && <span className="num ml-1 font-normal text-muted">{n}</span>}
                {mine > 0 && <span className="ml-1 text-emerald" title={`${mine} saved Real % entr${mine === 1 ? 'y' : 'ies'}`}>●</span>}
              </button>
            );
          })}
        </div>
        <div className="seg ml-auto" role="group" aria-label="Market filter">
          {(['all', 'moneyline', 'spread', 'total'] as const).map((t) => (
            <button key={t} aria-pressed={typeF === t} onClick={() => setTypeF(t)}>{t === 'all' ? 'All markets' : t === 'moneyline' ? 'Moneyline' : t === 'spread' ? 'Spread' : 'Total'}</button>
          ))}
        </div>
        <label className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field !w-52 !pl-8" placeholder="Search team or league" aria-label="Search games" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <StatusBar st={st} now={now} onReload={onReload} sport={sport} />

      {st.loading && !st.data && <Loading label={`Loading ${sport} odds from Kalshi, Polymarket and DraftKings…`} />}
      {st.error && !st.data && !st.loading && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {st.error} <button className="btn-ghost btn-sm ml-2" onClick={onReload}>Retry</button>
        </div>
      )}

      {st.data && total === 0 && (() => {
        const r = emptyReason(sport, st.data);
        return (
          <div className={`rounded-md border px-4 py-6 text-center ${r.tone === 'error' ? 'border-danger/30 bg-danger/5' : 'border-line bg-surface'}`}>
            <div className="text-sm font-medium text-head">{r.title}</div>
            <p className="mx-auto mt-1 max-w-2xl text-xs leading-relaxed text-muted">{r.body}</p>
          </div>
        );
      })()}
      {st.data && total > 0 && events.length === 0 && <p className="px-1 text-sm text-muted">No game matches “{q}”.</p>}

      {groups.length > 0 && (
        <div className="panel overflow-hidden">
          <RowHeader cols={cols} />
          {groups.map(([key, evs]) => (
            <section key={key} aria-label={dayLabel(key)}>
              <h3 className="border-b border-line bg-base/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(key)}</h3>
              {evs.map((e) => {
                const types = marketTypes(e).filter((t) => typeF === 'all' || t === typeF);
                if (!types.length) return null;
                const when = startText(e);
                return (
                  <article key={e.id} className="border-b border-line last:border-b-0">
                    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5">
                      <span className="chip-muted">{e.league}</span>
                      <h4 className="text-sm font-semibold text-head">{e.away} <span className="font-normal text-muted">@</span> {e.home}</h4>
                      <span className="num text-xs text-muted" title={when.approx ? 'No source published a kick-off time — only the date is known' : new Date(e.startsAt).toString()}>{when.text}</span>
                      {e.status === 'live' && <span className="chip-amber" title="In play — lines move fast and Real’s % may be stale">LIVE</span>}
                    </header>
                    {types.map((t) => {
                      const lines = linesOf(e, t, cfg.devig, cfg.include);
                      const oid = openId(e, t);
                      const withEntry = lines.find((l) => lookupEntry(store, e, t, l));
                      const chosen = lineSel[oid];
                      const line = t === 'moneyline' ? null : chosen != null && lines.includes(chosen) ? chosen : withEntry ?? lines[0] ?? null;
                      return (
                        <MarketRow
                          key={t}
                          event={e}
                          type={t}
                          lines={lines}
                          line={line}
                          onLine={(l) => setLineSel((s) => ({ ...s, [oid]: l }))}
                          cfg={cfg}
                          store={store}
                          open={openKey === oid}
                          onToggle={() => setOpenKey(openKey === oid ? null : oid)}
                          onSave={(v) => onSave(e, t, line, v)}
                          anchorId={anchorOf(e, t)}
                          cols={cols}
                          auto={t === 'moneyline' && suggestions.length ? findAuto(suggestions, e) : null}
                          now={now}
                        />
                      );
                    })}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
