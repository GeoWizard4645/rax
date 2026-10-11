import { ClipboardPaste, Database, FlaskConical, Radio } from 'lucide-react';
import type { ReactNode } from 'react';

export type SourceId = 'real' | 'rateboard' | 'imported' | 'sample';

export interface SourceOption {
  value: SourceId;
  label: string;
  /** False greys the option out (e.g. nothing imported yet). */
  available: boolean;
  /** One line that says exactly what this source is. */
  hint: string;
  /** Small status text under the label (e.g. "42 bids", "2.1 days"). */
  status?: ReactNode;
}

const ICON: Record<SourceId, ReactNode> = {
  real: <Database size={12} />,
  rateboard: <Radio size={12} />,
  imported: <ClipboardPaste size={12} />,
  sample: <FlaskConical size={12} />,
};

/** "Data source" switch shown at the top of Tabs 2–3. Every option states what it is; SAMPLE stays selectable and is badged. */
export default function SourceSelect({ value, onChange, options }: { value: SourceId; onChange: (v: SourceId) => void; options: SourceOption[] }) {
  const cur = options.find((o) => o.value === value);
  return (
    <div className="space-y-1.5" aria-label="Data source">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Data source</span>
        <div className="seg flex-wrap" role="group" aria-label="Data source">
          {options.map((o) => (
            <button key={o.value} aria-pressed={value === o.value} disabled={!o.available} title={o.hint} onClick={() => onChange(o.value)} className="inline-flex items-center gap-1.5 disabled:opacity-40">
              {ICON[o.value]} {o.label}
              {o.status != null && <span className="num text-[10px] text-muted">{o.status}</span>}
            </button>
          ))}
        </div>
      </div>
      {cur && <p className="text-[11px] text-muted">{cur.hint}</p>}
    </div>
  );
}
