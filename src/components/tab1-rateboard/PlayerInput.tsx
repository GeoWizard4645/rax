import { useEffect, useRef, useState } from 'react';
import { searchPlayers, type PlayerHit } from '../../lib/rateboardClient';
import { RB_PLAYER_EXAMPLES, houseFor, type RbBoard, type RbSport } from '../../../shared/rateboard';

/** Player autocomplete backed by Rateboard's live roster index (/api/players). */
export default function PlayerInput({ value, onChange, sport, board, onPick }: { value: string; onChange: (v: string) => void; sport: RbSport; board: RbBoard; onPick?: () => void }) {
  const [items, setItems] = useState<PlayerHit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const qy = value.trim();
    if (qy.length < 2) {
      setItems([]);
      setNote(null);
      setOpen(false);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const d = await searchPlayers(sport, qy, ctl.signal);
        const list = (d.players || []).filter((it) => {
          const h = houseFor(board, sport, it.name);
          return !(h && h.exact);
        });
        setItems(list);
        setNote(!list.length ? (d.building ? 'Still building the player list — try again in a bit' : 'No matches') : d.building ? 'Still indexing — more players will show up soon' : null);
        setActive(-1);
        setOpen(true);
      } catch {
        setOpen(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [value, sport, board]);

  useEffect(() => {
    const click = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    skip.current = true;
    onChange(it.name);
    setOpen(false);
    onPick?.();
  };

  return (
    <div className="relative" ref={wrap}>
      <input
        className="field"
        value={value}
        placeholder={`e.g. ${RB_PLAYER_EXAMPLES[sport]}`}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === 'Enter' && active > -1) (e.preventDefault(), pick(active));
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (items.length > 0 || note) && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface shadow-xl">
          {items.map((it, i) => (
            <li
              key={`${it.name}-${it.team}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(i))}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${i === active ? 'bg-hover' : 'hover:bg-hover'}`}
            >
              <span>{it.name}</span>
              <span className="text-xs text-muted">{it.team}</span>
            </li>
          ))}
          {note && <li className="px-3 py-1.5 text-xs text-muted">{note}</li>}
        </ul>
      )}
    </div>
  );
}
