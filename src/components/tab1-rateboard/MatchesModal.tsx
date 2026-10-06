import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  HOUSE, RB_ORIGIN, RB_SPORTS, bigOrderMessage, bigOrders, bigOrdersHaul, buildMatches, copyMessage, fmtVal,
  houseMessage, owedFor, type RbBoard, type RbSport, type SellerCard,
} from '../../../shared/rateboard';
import { load, save } from '../../lib/storage';
import { Modal } from '../ui/Modal';
import { CopyButton } from '../ui/CopyButton';
import { loadExcludes } from './ExcludeManager';

type SortMode = 'rate' | 'value' | 'orders';
const SORT_KEY = 'rax_rb_sell_sort';

/** "Your best sellers" — your cards matched to standing buy offers, with Rateboard's exact copy-messages. */
export default function MatchesModal({ board, sport, cards, onClose }: { board: RbBoard; sport: RbSport; cards: SellerCard[]; onClose: () => void }) {
  const m = useMemo(() => buildMatches(board, sport, cards, loadExcludes()), [board, sport, cards]);
  const orders = useMemo(() => bigOrders(m.rows), [m.rows]);
  const [mode, setMode] = useState<SortMode>(() => {
    const v = load<string>(SORT_KEY, 'rate');
    return v === 'value' || v === 'orders' ? v : 'rate';
  });
  const setSort = (s: SortMode) => (setMode(s), save(SORT_KEY, s));
  const label = RB_SPORTS[sport];

  const rows = useMemo(() => {
    const r = [...m.rows];
    if (mode === 'rate') r.sort((a, b) => b.buyers[0].rate - a.buyers[0].rate || (b.value ?? -1) - (a.value ?? -1));
    if (mode === 'value') r.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.buyers[0].rate - a.buyers[0].rate);
    return r;
  }, [m.rows, mode]);

  const ordersHaul = bigOrdersHaul(orders);
  const headline = mode === 'orders' ? ordersHaul.amount : m.haul;
  const headSub = mode === 'orders' ? (ordersHaul.cards ? `selling ${ordersHaul.cards} card${ordersHaul.cards === 1 ? '' : 's'} through these buyers` : 'nothing to sell in one go yet') : 'selling every card to its highest buyer';
  const house = useMemo(() => houseMessage(m.blocked), [m.blocked]);
  const [qs, setQs] = useState(false);

  return (
    <>
      <Modal title="Your best sellers" onClose={onClose} wide>
        {m.rows.length ? (
          <>
            <p className="hint">
              Found {m.playerCount} player{m.playerCount === 1 ? '' : 's'} in your collection. {m.rows.length} {m.rows.length === 1 ? 'has' : 'have'} a standing {label} offer — {m.totalBuyers} buyer{m.totalBuyers === 1 ? '' : 's'} in total.
            </p>
            {headline > 0 && (
              <div className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <b className="num text-xl text-emerald">{headline.toLocaleString('en-US')}</b>
                <span className="text-sm text-muted">{headSub}</span>
                <small className="num text-xs text-muted">{Math.round(headline * 0.9).toLocaleString('en-US')} after 10%</small>
                {mode !== 'orders' && m.unpriced > 0 && (
                  <small className="text-xs text-muted">
                    {m.unpriced} card{m.unpriced === 1 ? '' : 's'} left out — no rating read
                  </small>
                )}
              </div>
            )}
            <div className="seg" role="group" aria-label="Sort by">
              {([['rate', 'Best rate'], ['value', 'Card value'], ['orders', 'Big orders']] as const).map(([k, l]) => (
                <button key={k} aria-pressed={mode === k} onClick={() => setSort(k)}>
                  {l}
                </button>
              ))}
            </div>

            {mode === 'orders' ? (
              orders.length === 0 ? (
                <p className="hint">No one is buying more than one of your {label} cards right now. Best rate and card value still work.</p>
              ) : (
                <>
                  <p className="hint">
                    {orders.length} buyer{orders.length === 1 ? '' : 's'} want{orders.length === 1 ? 's' : ''} more than one of your cards — sell the lot in one message.
                  </p>
                  {orders.map((e) => {
                    const msg = bigOrderMessage(e);
                    return (
                      <div key={e.user} className="rounded-md border border-line">
                        <div className="flex flex-wrap items-baseline gap-3 border-b border-line px-3 py-2">
                          <b className="text-sm">{e.who}</b>
                          <span className="text-xs text-muted">{e.cards.length} of your cards</span>
                          {e.total > 0 && <span className="num text-xs text-emerald">{e.total.toLocaleString('en-US')} total</span>}
                        </div>
                        {e.cards.map((c) => (
                          <div key={c.player} className="grid grid-cols-[56px_1fr] items-center gap-3 px-3 py-1.5 text-sm">
                            <span className="num font-semibold text-emerald">
                              {c.rate}
                              <small className="text-xs text-muted">/1</small>
                            </span>
                            <span>
                              {c.player}
                              <span className="num block text-xs text-muted">{c.owed != null ? `${c.value} × ${c.rate}/1 = ${c.owed.toLocaleString('en-US')}` : 'no rating read for this card'}</span>
                            </span>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                          <CopyButton text={msg || ''} disabled={!msg} label="Copy message" toast={`Message for ${e.who} copied`} />
                          {e.link ? (
                            <a className="btn-ghost btn-sm !no-underline" href={e.link} target="_blank" rel="noopener noreferrer">
                              Message {e.who} <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span className="text-xs text-muted">No comment link on file</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )
            ) : (
              rows.map((h) => (
                <div key={h.player} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-baseline gap-3 border-b border-line px-3 py-2">
                    <b className="text-sm">{h.player}</b>
                    {h.value != null && <span className="num text-xs text-muted">rating {fmtVal(h.value)}</span>}
                    <span className="text-xs text-muted">
                      {h.buyers.length} buyer{h.buyers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {h.buyers.map((b) => {
                    const priced = h.value != null && h.value > 0;
                    const text = priced ? copyMessage(h.value as number, h.player, b.rate) : '';
                    return (
                      <div key={b.user} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-line/50 px-3 py-2 last:border-b-0">
                        <span className="num font-semibold text-emerald">
                          {b.rate}
                          <small className="text-xs text-muted">/1</small>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm">{b.buyer}</span>
                          <span className="num block truncate text-xs text-muted">{priced ? text : 'No rating read for this card — nothing to quote.'}</span>
                        </span>
                        <span className="flex flex-wrap justify-end gap-1.5">
                          <CopyButton text={text} disabled={!priced} label="Copy message" toast="Message copied" />
                          {b.link && (
                            <a className="btn-ghost btn-sm !no-underline" href={b.link} target="_blank" rel="noopener noreferrer">
                              Message <ExternalLink size={12} />
                            </a>
                          )}
                          <a className="btn-ghost btn-sm !no-underline" href={RB_ORIGIN} target="_blank" rel="noopener noreferrer" title="Reports are handled on Rateboard">
                            Report ↗
                          </a>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            Read {m.playerCount} player{m.playerCount === 1 ? '' : 's'}, but none of them have a standing {label} offer right now. Check back, or switch sports if the pull was for a different one.
          </p>
        )}

        {m.blocked.length > 0 && (
          <div className="rounded-md border border-line">
            <div className="flex flex-wrap items-baseline gap-3 border-b border-line px-3 py-2">
              <b className="text-sm">{HOUSE.buyer} buys these</b>
              <span className="text-xs text-muted">
                {m.blocked.length} card{m.blocked.length === 1 ? '' : 's'}
              </span>
              {house.total > 0 && <span className="num text-xs text-emerald">{house.total.toLocaleString('en-US')} total</span>}
            </div>
            {house.sure.map((b) => (
              <div key={b.name} className="grid grid-cols-[56px_1fr] items-center gap-3 px-3 py-1.5 text-sm">
                <span className="num font-semibold text-emerald">
                  {b.cfg.rate}
                  <small className="text-xs text-muted">/1</small>
                </span>
                <span>
                  {b.name}
                  <span className="num block text-xs text-muted">
                    {(b.value ?? 0) > 0 ? `${b.value} × ${b.cfg.rate}/1 = ${owedFor(b.value as number, b.cfg.rate).toLocaleString('en-US')}` : 'no rating read for this card'}
                  </span>
                </span>
              </div>
            ))}
            {house.check.length > 0 && (
              <p className="hint px-3 pb-1">
                {house.check.map((b) => (
                  <span key={b.name} className="block">
                    <b>{b.name}</b> — more than one player goes by that name. {HOUSE.buyer} only buys {b.cfg.player}; if that's the card you have, mention it in your message.
                  </span>
                ))}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
              {house.msg && <CopyButton text={house.msg} label="Copy message" toast="Message copied" />}
              <a className="btn-ghost btn-sm !no-underline" href={HOUSE.link} target="_blank" rel="noopener noreferrer">
                Message {HOUSE.buyer} <ExternalLink size={12} />
              </a>
            </div>
            {house.msg && <pre className="whitespace-pre-wrap px-3 pb-2 font-mono text-xs text-muted">{house.msg}</pre>}
          </div>
        )}

        {m.quicksells.length > 0 && (
          <button className="btn-ghost w-full" onClick={() => setQs(true)}>
            View recommended quicksells ({m.quicksells.length})
          </button>
        )}
      </Modal>

      {qs && (
        <Modal title="Recommended quicksells" onClose={() => setQs(false)}>
          <p className="hint">
            Nobody on the board is buying these and none of them are on the {label} keep list, so they're the safest ones to quicksell. Worth a second look yourself before you dump anything — the board only knows about offers people have actually posted.
          </p>
          {m.quicksells.map((p) => (
            <div key={p.name} className="flex items-center justify-between rounded-md border border-line px-3 py-1.5 text-sm">
              <span>{p.name}</span>
              <span className="num text-xs text-muted">
                {p.boost != null ? `${p.boost} boost` : ''}
                {p.owned != null ? `${p.boost != null ? ' — ' : ''}you own ${p.owned}` : ''}
              </span>
            </div>
          ))}
          <CopyButton text={m.quicksells.map((p) => p.name).join('\n')} label="Copy the list" className="btn-ghost" toast="Quicksell list copied" />
        </Modal>
      )}
    </>
  );
}
