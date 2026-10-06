import { useMemo, useState } from 'react';
import { Camera } from 'lucide-react';
import {
  HOUSE, RB_ORIGIN, RB_SPORTS, TARGET_LINK, checkNewOffer, houseFor, liveOffers, minimumFor, readRate,
  resolveRateSel, validCommentLink, type RbBoard, type RbSport,
} from '../../../shared/rateboard';
import { addOffer, newId, removeOffer } from '../../lib/rateboardClient';
import { Spinner } from '../ui/StateBlock';
import { useToast } from '../ui/Toast';
import EditOffer, { RateSelect } from './EditOffer';
import PlayerInput from './PlayerInput';

const GUIDES = [
  { src: 'examples/buy-1-open-post.jpg', cap: '1. Tap "this post" to open the post on Real.' },
  { src: 'examples/buy-2-write-comment.jpg', cap: '2. Comment with your card and your rate, like this.' },
  { src: 'examples/buy-3-paste-link.jpg', cap: "3. Copy your comment's link, paste it below, then Post offer." },
];

export default function BuyerPanel({ board, sport, me, meKey, refresh }: { board: RbBoard; sport: RbSport; me: string; meKey: string; refresh: (fresh?: boolean) => Promise<unknown> }) {
  const notify = useToast();
  const [player, setPlayer] = useState('');
  const [rateSel, setRateSel] = useState('20');
  const [custom, setCustom] = useState('');
  const [link, setLink] = useState('');
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);

  const trimmed = player.trim();
  const min = trimmed.length >= 2 ? minimumFor(board, sport, trimmed) : null;
  const hs = trimmed.length >= 2 ? houseFor(board, sport, trimmed) : null;
  const sel = resolveRateSel(rateSel, min?.rate);
  const mine = useMemo(() => liveOffers(board, sport).filter((o) => o.user === meKey), [board, sport, meKey]);

  const post = async () => {
    const rate = readRate(sel, custom, min?.rate);
    const check = checkNewOffer(board, sport, player, link, rate, sel === 'custom' ? +custom : undefined);
    if (!check.ok) return notify(check.error, 'error');
    setBusy(true);
    const r = await addOffer({ id: newId(), user: meKey, sport, player: check.player, rate: check.rate, link: link.trim() });
    setBusy(false);
    if (!r.ok) return notify(r.message, 'error');
    setPlayer('');
    setLink('');
    notify(`Posted ${check.player} at ${check.rate}/1`);
    void refresh(true);
  };

  const remove = async (id: string) => {
    const o = board.offers.find((x) => x.id === id);
    const r = await removeOffer(id, meKey);
    if (!r.ok) return notify(r.message, 'error');
    notify(o ? `Removed ${o.player}` : 'Removed');
    void refresh(true);
  };

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <h2>Post a buy offer</h2>
          <span className="text-xs text-muted">as {me}</span>
        </div>
        <div className="panel-bd space-y-3">
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            When done grinding please remove listing, if listing is not removed in a timely manner after you're done buying you will be banned
          </div>
          <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-relaxed text-amber/90">
            To buy cards, get the card link of the player or team you're upgrading, and post a comment under{' '}
            <a href={TARGET_LINK} target="_blank" rel="noopener noreferrer">
              this post
            </a>{' '}
            with your card and any extra details you want to add. Once you have created the comment, paste it below (it is auto verified).
          </div>
          <button className="btn-ghost w-full text-xs" aria-expanded={guide} onClick={() => setGuide(!guide)}>
            <Camera size={13} /> {guide ? 'HIDE PICTURE GUIDES' : 'PICTURE GUIDES OF HOW TO SUBMIT COMMENT'}
          </button>
          {guide && (
            <div className="grid gap-3 sm:grid-cols-3">
              {GUIDES.map((g) => (
                <figure key={g.src} className="space-y-1">
                  <a href={`${RB_ORIGIN}/${g.src}`} target="_blank" rel="noopener noreferrer">
                    <img src={`${RB_ORIGIN}/${g.src}`} alt={g.cap} loading="lazy" className="w-full rounded-md border border-line" />
                  </a>
                  <figcaption className="text-[11px] text-muted">{g.cap}</figcaption>
                </figure>
              ))}
              <p className="col-span-full text-[11px] text-muted">Guide images are loaded from Rateboard.</p>
            </div>
          )}
          <div>
            <label className="label" htmlFor="b-player">
              Player
            </label>
            <PlayerInput value={player} onChange={setPlayer} sport={sport} board={board} />
          </div>
          <div>
            <label className="label" htmlFor="b-rate">
              Rate you'll pay
            </label>
            <RateSelect id="b-rate" value={sel} onChange={setRateSel} custom={custom} onCustom={setCustom} floor={min?.rate} />
            {min && (
              <p className="hint mt-1">
                Minimum for {min.player} is {min.rate}/1 — you can't offer less{sel === 'custom' ? ', custom included' : ''}.
              </p>
            )}
            {hs && hs.exact && (
              <p className="hint mt-1 text-amber">
                {hs.player} is one of {HOUSE.buyer}'s — he buys him at {hs.rate}/1. The rest of the {HOUSE.label} are open.
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="b-link">
              Your comment link
            </label>
            <input id="b-link" className="field" value={link} onChange={(e) => setLink(e.target.value)} autoComplete="off" placeholder="https://www.realapp.com/..." aria-invalid={!!link && !validCommentLink(link.trim())} />
          </div>
          <button className="btn-primary w-full" onClick={post} disabled={busy || !!(hs && hs.exact)}>
            {busy && <Spinner />} Post offer
          </button>
          <p className="hint">Rates are per 1. Posting the same player twice replaces your earlier offer. A valid comment link is required — sellers use it to reach you.</p>
          <a className="btn-ghost w-full !no-underline" href={RB_ORIGIN} target="_blank" rel="noopener noreferrer">
            View top players on Rateboard ↗
          </a>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>Your buys</h2>
          <span className="num text-xs text-muted">{mine.length ? `${mine.length} in ${sport}` : ''}</span>
        </div>
        {mine.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">
            <b className="block text-sm text-head">No offers in {RB_SPORTS[sport]}</b>Anything you post shows up here.
          </div>
        ) : (
          <ul>
            {mine.map((o) => (
              <li key={o.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-line/60 px-3 py-2 hover:bg-hover">
                <span className="num font-semibold text-emerald">
                  {o.rate}
                  <small className="text-xs text-muted">/1</small>
                </span>
                <span className="truncate text-sm">{o.player}</span>
                <span className="flex gap-1.5">
                  <button className="btn-ghost btn-sm" onClick={() => setEdit(o.id)}>
                    Change
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => remove(o.id)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {edit && (
        <EditOffer
          board={board}
          id={edit}
          meKey={meKey}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void refresh(true);
          }}
        />
      )}
    </>
  );
}
