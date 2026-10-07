import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { liveOffers, RB_SPORTS, type RbBoard, type RbSport } from '../../../shared/rateboard';
import { Empty } from '../ui/StateBlock';
import { useUfc } from '../../hooks/useUfc';
import { findFighter } from '../../../shared/ufc';
import UfcChip from '../ui/UfcChip';
import TradeLink from './TradeLink';
import { RB_ORIGIN } from '../../../shared/rateboard';

const PAGE = 120;

export default function BoardList({ board, sport, meKey, onEdit, onRemove }: { board: RbBoard; sport: RbSport; meKey: string | null; onEdit: (id: string) => void; onRemove: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const ufc = useUfc(sport === 'UFC');
  const live = useMemo(() => liveOffers(board, sport), [board, sport]);
  const f = filter.trim().toLowerCase();
  const rows = useMemo(() => (f ? live.filter((o) => o.player.toLowerCase().includes(f) || (board.users[o.user]?.name || o.user).toLowerCase().includes(f)) : live), [live, f, board.users]);

  return (
    <section className="panel" aria-label={`${RB_SPORTS[sport]} buy offers`}>
      <div className="panel-hd">
        <h2>{RB_SPORTS[sport]} buy offers</h2>
        <span className="num text-xs text-muted">{live.length ? `${live.length} standing` : ''}</span>
      </div>
      <div className="relative border-b border-line px-3 py-2">
        <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field !pl-8" placeholder="Filter by player or buyer…" value={filter} onChange={(e) => (setFilter(e.target.value), setShown(PAGE))} aria-label="Filter offers" />
      </div>
      {live.length === 0 ? (
        <Empty title="Nothing on the board yet">Post the first {RB_SPORTS[sport]} offer and sellers will see it.</Empty>
      ) : rows.length === 0 ? (
        <Empty title="No offers match that filter" />
      ) : (
        <ul>
          {rows.slice(0, shown).map((o) => {
            const mine = !!meKey && o.user === meKey;
            const who = board.users[o.user]?.name || o.user;
            return (
              <li key={o.id} className={`grid grid-cols-[64px_1fr_auto] items-center gap-3 border-b border-line/60 px-3 py-2 hover:bg-hover ${mine ? 'bg-emerald/5' : ''}`}>
                <span className="num text-base font-semibold text-emerald">
                  {o.rate}
                  <small className="text-xs text-muted">/1</small>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {o.player}
                    {sport === 'UFC' && (() => { const f = findFighter(ufc.index, o.player); return f ? <> <UfcChip f={f} /></> : null; })()}
                  </span>
                  <span className="block truncate text-xs text-muted">{who}</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {mine ? (
                    <>
                      <button className="btn-ghost btn-sm" onClick={() => onEdit(o.id)}>
                        Change rate
                      </button>
                      <button className="btn-danger btn-sm" onClick={() => onRemove(o.id)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <a className="btn-ghost btn-sm !no-underline" href={RB_ORIGIN} target="_blank" rel="noopener noreferrer" title="Reports are handled on Rateboard">
                      Report ↗
                    </a>
                  )}
                  <TradeLink player={o.player} sport={sport} compact />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > shown && (
        <div className="p-3 text-center">
          <button className="btn-ghost btn-sm" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        </div>
      )}
    </section>
  );
}
