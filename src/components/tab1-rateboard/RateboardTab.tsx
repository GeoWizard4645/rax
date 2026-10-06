import { useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { RB_SPORTS, type RbSport } from '../../../shared/rateboard';
import { useRbBoard } from '../../hooks/useRbBoard';
import { load, save } from '../../lib/storage';
import { removeOffer } from '../../lib/rateboardClient';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import BoardList from './BoardList';
import BuyerPanel from './BuyerPanel';
import Gate from './Gate';
import OutboundBanner from './OutboundBanner';
import ProfileInspector from './ProfileInspector';
import SellerPanel from './SellerPanel';
import { RbSessionProvider, useRbSession } from './useRbSession';
import EditOffer from './EditOffer';

const SPORT_KEY = 'rax_rb_sport';
const HIDE_KEY = 'rax_rb_board_hidden';

function BoardView() {
  const { board, error, loading, refresh, fetchedAt } = useRbBoard();
  const { me, key, signOut } = useRbSession();
  const notify = useToast();
  const [sport, setSport] = useState<RbSport>(() => {
    const s = load<string>(SPORT_KEY, 'CFB');
    return s in RB_SPORTS ? (s as RbSport) : 'CFB';
  });
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [hidden, setHidden] = useState(() => load<boolean>(HIDE_KEY, false));
  const [editId, setEditId] = useState<string | null>(null);
  useEffect(() => void save(SPORT_KEY, sport), [sport]);

  const removeMine = async (id: string) => {
    if (!key) return;
    const o = board?.offers.find((x) => x.id === id);
    const r = await removeOffer(id, key);
    if (!r.ok) return notify(r.message, 'error');
    notify(o ? `Removed ${o.player}` : 'Removed');
    void refresh(true);
  };

  if (loading && !board) return <Loading label="Reading the Rateboard…" />;
  if (!board) return <ErrorBlock message={error || "Couldn't reach the shared board right now."} onRetry={() => void refresh(true)} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="rb-sport" className="sr-only">
            Sport
          </label>
          <select id="rb-sport" className="field !w-auto font-semibold" value={sport} onChange={(e) => setSport(e.target.value as RbSport)}>
            {(Object.keys(RB_SPORTS) as RbSport[]).map((s) => (
              <option key={s} value={s}>
                {RB_SPORTS[s]}
              </option>
            ))}
          </select>
          <button className="btn-ghost btn-sm" onClick={() => void refresh(true)} title="Re-read the board from Rateboard">
            <RefreshCw size={13} /> Refresh
          </button>
          {fetchedAt && <span className="num hidden text-[11px] text-muted sm:inline">updated {new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
        </div>
        {me && (
          <div className="flex items-center gap-2 text-sm text-muted">
            Signed in as <b className="text-head">{me}</b>
            <button className="btn-ghost btn-sm" onClick={signOut}>
              <LogOut size={13} /> Sign out
            </button>
          </div>
        )}
      </div>

      {error && <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90">Couldn't reach the shared board right now. Your last action may not have saved — try again in a moment.</div>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {!(mode === 'sell' && hidden) && <BoardList board={board} sport={sport} meKey={key} onEdit={setEditId} onRemove={removeMine} />}
        <aside className={`space-y-3 ${mode === 'sell' && hidden ? 'lg:col-span-2 lg:max-w-[400px]' : ''}`}>
          {!me || !key ? (
            <Gate />
          ) : (
            <>
              <Segmented value={mode} onChange={setMode} label="Mode" options={[{ value: 'buy', label: 'Buyer' }, { value: 'sell', label: 'Seller' }]} />
              {mode === 'buy' ? (
                <BuyerPanel board={board} sport={sport} me={me} meKey={key} refresh={refresh} />
              ) : (
                <SellerPanel
                  board={board}
                  sport={sport}
                  me={me}
                  refresh={refresh}
                  boardHidden={hidden}
                  onToggleBoard={() => {
                    save(HIDE_KEY, !hidden);
                    setHidden(!hidden);
                  }}
                />
              )}
            </>
          )}
        </aside>
      </div>

      {editId && (
        key && (
          <EditOffer
            board={board}
            id={editId}
            meKey={key}
            onClose={() => setEditId(null)}
            onSaved={() => {
              setEditId(null);
              void refresh(true);
            }}
          />
        )
      )}
    </div>
  );
}

export default function RateboardTab() {
  const [view, setView] = useState<'board' | 'profile'>('board');
  return (
    <RbSessionProvider>
      <div className="space-y-4">
        <OutboundBanner />
        <Segmented value={view} onChange={setView} label="View" options={[{ value: 'board', label: 'Rate Board' }, { value: 'profile', label: 'Profile Inspector' }]} />
        {view === 'board' ? <BoardView /> : <ProfileInspectorWithBoard />}
      </div>
    </RbSessionProvider>
  );
}

function ProfileInspectorWithBoard() {
  const { board, error, loading, refresh } = useRbBoard();
  if (loading && !board) return <Loading label="Reading the Rateboard…" />;
  if (!board) return <ErrorBlock message={error || "Couldn't reach the shared board right now."} onRetry={() => void refresh(true)} />;
  return <ProfileInspector board={board} />;
}
