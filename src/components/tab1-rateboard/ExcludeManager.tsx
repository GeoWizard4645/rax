import { useState } from 'react';
import { load, save } from '../../lib/storage';
import { norm } from '../../../shared/rateboard';
import { Modal } from '../ui/Modal';

const KEY = 'rax_rb_exclude_v1';
export const loadExcludes = (): string[] => {
  const v = load<unknown>(KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

/** Players/teams a seller never wants surfaced in their scan results. Stored only in this browser. */
export default function ExcludeManager({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState(loadExcludes);
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (!list.some((x) => norm(x) === norm(n))) {
      const next = [...list, n];
      save(KEY, next);
      setList(next);
    }
    setName('');
  };
  const rm = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    save(KEY, next);
    setList(next);
  };
  return (
    <Modal title="Exclude players/teams" onClose={onClose}>
      <p className="hint">Anything you add here is left out of your results from now on, even when someone has a standing offer on it. Stored only in this browser.</p>
      <div className="flex gap-2">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Julian Sayin, or a team name" />
        <button className="btn-ghost shrink-0" onClick={add}>
          Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className="hint">Nothing excluded yet.</p>
      ) : (
        list.map((n, i) => (
          <div key={n} className="flex items-center justify-between rounded-md border border-line px-3 py-1.5 text-sm">
            <span>{n}</span>
            <button className="btn-ghost btn-sm" onClick={() => rm(i)}>
              Remove
            </button>
          </div>
        ))
      )}
    </Modal>
  );
}
