import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { RB_ORIGIN, RB_PULLABLE, RB_SPORTS, type RbBoard, type RbSport, type SellerCard } from '../../../shared/rateboard';
import { pullCollection } from '../../lib/rateboardClient';
import { Spinner } from '../ui/StateBlock';
import ExcludeManager from './ExcludeManager';
import MatchesModal from './MatchesModal';

/** Cards come out of a cache on Rateboard that rolls over every 2 hours. */
function nextUpdate(now = Date.now()) {
  const slot = 2 * 60 * 60 * 1000;
  return new Date(Math.ceil(now / slot) * slot).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function SellerPanel({
  board, sport, me, refresh, boardHidden, onToggleBoard,
}: { board: RbBoard; sport: RbSport; me: string; refresh: (fresh?: boolean) => Promise<RbBoard | null>; boardHidden: boolean; onToggleBoard: () => void }) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [cards, setCards] = useState<SellerCard[] | null>(null);
  const [matchBoard, setMatchBoard] = useState<RbBoard | null>(null);
  const [excl, setExcl] = useState(false);
  const [next, setNext] = useState(nextUpdate());
  useEffect(() => {
    const id = window.setInterval(() => setNext(nextUpdate()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const pullable = RB_PULLABLE.includes(sport);

  const pull = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const players = await pullCollection(me, sport, (p) =>
        setLabel(p.waitSec ? `Starting in ${p.waitSec}s…` : `Fetching cards${p.chunk > 1 ? ` (${p.chunk})` : ''}…`),
      );
      if (!players.length) return setMsg({ text: `No ${RB_SPORTS[sport]} cards found for "${me}" on Real Sports.`, error: true });
      // Match against the *current* board, as Rateboard does (it re-reads before matching).
      const fresh = (await refresh(true)) ?? board;
      setMatchBoard(fresh);
      setCards(players.map((p) => ({ name: p.name, boost: p.totalValue || null, owned: p.total, totalValue: p.totalValue })));
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
      setLabel('');
    }
  };

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Scan your stats</h2>
      </div>
      <div className="panel-bd space-y-3">
        {pullable ? (
          <div>
            <button className="btn-primary w-full" onClick={pull} disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {label || 'Fetching cards…'}
                </>
              ) : (
                <>
                  <Download size={14} /> Pull my {RB_SPORTS[sport]} cards from Real
                </>
              )}
            </button>
            {msg && <p className={`mt-1.5 text-xs ${msg.error ? 'text-danger' : 'text-muted'}`}>{msg.text}</p>}
            <p className="hint mt-1.5">
              Pulls the collection for <b className="text-head">{me}</b>. Collection data updates every 2 hours. Next update {next}.
            </p>
          </div>
        ) : (
          <p className="hint">{sport === 'NHL' ? 'Will add after gens drop.' : "Card pull isn't set up for this sport yet."}</p>
        )}
        <a className="btn-ghost w-full !no-underline" href={RB_ORIGIN} target="_blank" rel="noopener noreferrer">
          Read screenshots on Rateboard ↗
        </a>
        <p className="hint">Screenshot reading uses Rateboard's own paid reader, so it stays on their site.</p>
        <button className="btn-ghost w-full" onClick={() => setExcl(true)}>
          Exclude players/teams
        </button>
        <button className="btn-ghost w-full" onClick={onToggleBoard}>
          {boardHidden ? 'Show' : 'Hide'} {RB_SPORTS[sport]} buy offers
        </button>
      </div>
      {excl && <ExcludeManager onClose={() => setExcl(false)} />}
      {cards && matchBoard && <MatchesModal board={matchBoard} sport={sport} cards={cards} onClose={() => setCards(null)} />}
    </div>
  );
}
