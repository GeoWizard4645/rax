import { useMemo, useState } from 'react';
import { Search, User } from 'lucide-react';
import { RB_PULLABLE, RB_SPORTS, liveOffers, owedFor, samePlayer, type RbBoard, type RbSport } from '../../../shared/rateboard';
import { useRealUser } from '../../hooks/useRealUser';
import { dec, rax } from '../../lib/format';
import { Empty, ErrorBlock, Spinner } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';
import TradeLink from './TradeLink';

type SortKey = 'value' | 'owned' | 'rate' | 'name';

/** Look up any Real username: profile header (when the Real API is configured) and their card collection, priced against Rateboard's live offers. */
export default function ProfileInspector({ board }: { board: RbBoard }) {
  const u = useRealUser();
  const [input, setInput] = useState('');
  const [sport, setSport] = useState<RbSport>('FC');
  const [sort, setSort] = useState<SortKey>('value');
  const [filter, setFilter] = useState('');

  const submit = () => void u.lookup(input, sport);
  const changeSport = (s: RbSport) => {
    setSport(s);
    if (u.username && !u.collections[s]) void u.ensureSport(s);
  };

  const rows = useMemo(() => {
    const live = liveOffers(board, sport);
    const list = (u.collections[sport] || []).map((c) => {
      const best = live.filter((o) => samePlayer(o.player, c.name)).sort((a, b) => b.rate - a.rate)[0];
      return { ...c, avg: c.total ? c.totalValue / c.total : 0, bestRate: best?.rate ?? null, bestBuyer: best ? board.users[best.user]?.name || best.user : null, est: best && c.totalValue > 0 ? owedFor(c.totalValue, best.rate) : null };
    });
    const f = filter.trim().toLowerCase();
    const filtered = f ? list.filter((r) => r.name.toLowerCase().includes(f)) : list;
    const by: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      value: (a, b) => b.totalValue - a.totalValue,
      owned: (a, b) => b.total - a.total || b.totalValue - a.totalValue,
      rate: (a, b) => (b.bestRate ?? -1) - (a.bestRate ?? -1) || b.totalValue - a.totalValue,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return filtered.sort(by[sort]);
  }, [u.collections, sport, board, sort, filter]);

  const all = u.collections[sport];
  const totals = useMemo(() => {
    const l = all || [];
    return { cards: l.reduce((n, c) => n + c.total, 0), players: l.length, value: l.reduce((n, c) => n + c.totalValue, 0), sellable: rows.reduce((n, r) => n + (r.est || 0), 0) };
  }, [all, rows]);

  return (
    <div className="space-y-4">
      <form
        className="panel flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="pi-user">
            Real App username
          </label>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id="pi-user" className="field !pl-8" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search any username" autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pi-sport">
            Sport
          </label>
          <select id="pi-sport" className="field" value={sport} onChange={(e) => changeSport(e.target.value as RbSport)}>
            {RB_PULLABLE.map((s) => (
              <option key={s} value={s}>
                {s} — {RB_SPORTS[s]}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" type="submit" disabled={!input.trim() || !!u.pulling}>
          {u.pulling ? <Spinner /> : <Search size={14} />} Look up
        </button>
      </form>

      {u.username && (
        <div className="panel">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            {u.profile?.avatarUrl ? (
              <img src={u.profile.avatarUrl} alt="" className="h-12 w-12 rounded-full border border-line object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-full border border-line bg-base text-muted">
                <User size={20} />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-base font-semibold">{u.profile?.username || u.username}</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {u.profile?.badges?.map((b) => (
                  <span key={b} className="chip-blue">
                    {b}
                  </span>
                ))}
              </div>
            </div>
            <div className="ml-auto grid grid-cols-3 gap-4 text-right">
              <div>
                <div className="label !mb-0">Karma</div>
                <div className="num text-sm">{rax(u.profile?.karma)}</div>
              </div>
              <div>
                <div className="label !mb-0">Rax balance</div>
                <div className="num text-sm text-emerald">{rax(u.profile?.raxBalance)}</div>
              </div>
              <div>
                <div className="label !mb-0">Cards owned</div>
                <div className="num text-sm">{u.profile?.cardCount != null ? rax(u.profile.cardCount) : all ? rax(totals.cards) + ' ' + sport : '—'}</div>
              </div>
            </div>
          </div>
          {(u.status === 'unconfigured' || u.status === 'error' || u.status === 'not_found') && (
            <div className="border-t border-line px-4 py-2 text-xs text-muted">
              {u.status === 'unconfigured'
                ? 'Profile picture, badges, Karma and Rax balance come from Real\'s mobile API, which isn\'t connected on this deployment (set REAL_API_BASE). The collection below is live from Rateboard.'
                : 'Could not load the profile header from Real\'s API. The collection below is live from Rateboard.'}
            </div>
          )}
        </div>
      )}

      {u.error && <ErrorBlock message={u.error} onRetry={() => void u.ensureSport(sport)} />}
      {u.pulling && (
        <div className="panel flex items-center gap-2 px-4 py-6 text-sm text-muted" role="status">
          <Spinner /> {u.progress?.waitSec ? `Starting in ${u.progress.waitSec}s… (Rateboard spreads load on uncached pulls)` : `Fetching ${RB_SPORTS[sport]} cards${u.progress && u.progress.chunk > 1 ? ` (${u.progress.chunk})` : ''}…`}
        </div>
      )}

      {all && !u.pulling && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={`${sport} cards`} value={rax(totals.cards)} sub={`${totals.players} players`} />
            <Stat label="Total boost value" value={dec(totals.value, 1)} />
            <Stat label="With a buyer" value={String(rows.filter((r) => r.bestRate).length)} sub="players" tone="blue" />
            <Stat label="Best-buyer total" value={rax(totals.sellable)} sub="Rax at best standing rates" tone="emerald" />
          </div>
          <div className="panel overflow-hidden">
            <div className="panel-hd flex-wrap">
              <h2>
                {RB_SPORTS[sport]} collection <span className="num text-xs font-normal text-muted">({rows.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <input className="field !w-44" placeholder="Filter players…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter players" />
                <select className="field !w-40" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
                  <option value="value">Sort: boost value</option>
                  <option value="owned">Sort: copies owned</option>
                  <option value="rate">Sort: best buyer rate</option>
                  <option value="name">Sort: name</option>
                </select>
              </div>
            </div>
            {rows.length === 0 ? (
              <Empty title={all.length ? 'No players match that filter' : `No ${RB_SPORTS[sport]} cards found for "${u.username}"`} />
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="tbl">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th>Player</th>
                      <th className="r">Owned</th>
                      <th className="r">Boost value</th>
                      <th className="r">Avg / card</th>
                      <th className="r">Best buyer</th>
                      <th className="r">Value at best rate</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name}>
                        <td className="font-medium">{r.name}</td>
                        <td className="r num">{r.total}</td>
                        <td className="r num">{dec(r.totalValue, 1)}</td>
                        <td className="r num text-muted">{dec(r.avg, 1)}</td>
                        <td className="r num">{r.bestRate ? <span className="text-emerald">{r.bestRate}/1</span> : <span className="text-muted">—</span>}</td>
                        <td className="r num">{r.est ? rax(r.est) : <span className="text-muted">—</span>}</td>
                        <td className="r">
                          <TradeLink player={r.name} sport={sport} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
              Collections are Rateboard's "pull my cards" data (refreshed every 2 hours). It reports counts and boost value per player — not rarity or per-game grades — so rarity filters and live grades aren't available here. Buyer rates are Rateboard's standing offers.
            </div>
          </div>
        </>
      )}

      {!u.username && <Empty title="Look up any Real App username">See their collection, how much boost value they hold, and what Rateboard buyers would pay for each player.</Empty>}
    </div>
  );
}
