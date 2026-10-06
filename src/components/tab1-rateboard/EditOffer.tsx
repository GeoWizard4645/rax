import { useState } from 'react';
import {
  CUSTOM_MAX, minimumFor, rateLabel, readRate, resolveRateSel, usableRates, validCommentLink, type RbBoard,
} from '../../../shared/rateboard';
import { updateOffer } from '../../lib/rateboardClient';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/StateBlock';
import { useToast } from '../ui/Toast';

export function RateSelect({ value, onChange, custom, onCustom, floor, id }: { value: string; onChange: (v: string) => void; custom: string; onCustom: (v: string) => void; floor?: number | null; id: string }) {
  return (
    <>
      <select id={id} className="field num" value={value} onChange={(e) => onChange(e.target.value)}>
        {usableRates(floor).map((r) => (
          <option key={r} value={r}>
            {rateLabel(r)}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {value === 'custom' && (
        <input className="field num mt-2" type="number" min={1} max={CUSTOM_MAX} step={1} inputMode="numeric" value={custom} onChange={(e) => onCustom(e.target.value)} placeholder="Type any rate, e.g. 31" aria-label="Custom rate" />
      )}
    </>
  );
}

/** "Change rate" dialog — used from both the board list and the Buyer panel. */
export default function EditOffer({ board, id, meKey, onClose, onSaved }: { board: RbBoard; id: string; meKey: string; onClose: () => void; onSaved: () => void }) {
  const o = board.offers.find((x) => x.id === id);
  const notify = useToast();
  const min = o ? minimumFor(board, o.sport, o.player) : null;
  const [sel, setSel] = useState(() => resolveRateSel(String(o?.rate ?? 20), min?.rate));
  const [custom, setCustom] = useState(o && !usableRates().includes(o.rate) ? String(o.rate) : '');
  const [link, setLink] = useState(o?.link || '');
  const [busy, setBusy] = useState(false);
  if (!o) return null;

  const save = async () => {
    const r = readRate(sel, custom, min?.rate);
    if (!Number.isFinite(r)) {
      if (sel === 'custom') {
        const typed = Math.round(+custom);
        if (min && typed >= 1 && typed < min.rate) return notify(`${min.player} has a ${min.rate}/1 minimum.`, 'error');
        return notify(`Type the rate you'll pay — a whole number from 1 to ${CUSTOM_MAX}.`, 'error');
      }
      return notify("Pick the rate you'll pay.", 'error');
    }
    if (min && r < min.rate) return notify(`${min.player} has a ${min.rate}/1 minimum.`, 'error');
    if (!validCommentLink(link.trim())) return notify("That doesn't look like a comment link on the pinned post.", 'error');
    setBusy(true);
    const res = await updateOffer(id, meKey, r, link.trim());
    setBusy(false);
    if (!res.ok) return notify(res.message, 'error');
    notify(`${o.player} now ${r}/1`);
    onSaved();
  };

  return (
    <Modal title={`Change offer — ${o.player}`} onClose={onClose}>
      <div>
        <label className="label" htmlFor="e-rate">
          New rate
        </label>
        <RateSelect id="e-rate" value={sel} onChange={setSel} custom={custom} onCustom={setCustom} floor={min?.rate} />
        {min && <p className="hint mt-1">Minimum for {min.player} is {min.rate}/1 — you can't offer less.</p>}
      </div>
      <div>
        <label className="label" htmlFor="e-link">
          Your comment link
        </label>
        <input id="e-link" className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.realapp.com/..." />
      </div>
      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy && <Spinner />} Save
      </button>
    </Modal>
  );
}
