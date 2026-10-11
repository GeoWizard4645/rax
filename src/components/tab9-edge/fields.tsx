import { useEffect, useRef, useState } from 'react';
import type { Confidence } from '../../../shared/otdRules';

export type Parse = (text: string) => number | null | 'invalid';

/** '' → null, a non-negative number → number, else 'invalid'. */
export const parsePos: Parse = (t) => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : 'invalid';
};

/**
 * Text input for a number that keeps what the user is typing ("58." stays "58.") and only pushes valid values up.
 * Re-syncs when the value is changed from outside (e.g. "set other side to 100 − x").
 */
export function NumInput({
  value,
  onCommit,
  parse = parsePos,
  placeholder,
  label,
  suffix,
  className = '',
  autoFocus,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  parse?: Parse;
  placeholder?: string;
  label: string;
  suffix?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? '' : String(value));
      setBad(false);
    }
  }, [value]);
  const change = (t: string) => {
    setText(t);
    const r = parse(t);
    if (r === 'invalid') return setBad(true);
    setBad(false);
    last.current = r;
    onCommit(r);
  };
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <input
        className={`field num ${suffix ? 'pr-7' : ''} ${bad ? '!border-danger' : ''}`}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={bad || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => change(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 text-xs text-muted">{suffix}</span>}
    </span>
  );
}

const CONF: Record<Confidence, { cls: string; label: string; title: string }> = {
  documented: { cls: 'chip-emerald', label: 'documented', title: 'Stated in Real’s own docs / changelog' },
  community: { cls: 'chip-blue', label: 'community', title: 'Reported by a third party (e.g. RaxEdge), not by Real' },
  inferred: { cls: 'chip-amber', label: 'inferred', title: 'Our deduction from the documented behaviour' },
  unknown: { cls: 'chip-amber', label: 'unknown · placeholder', title: 'Not published anywhere — the default is a labelled placeholder, not a finding' },
};

/** Confidence badge for a rule (same vocabulary as Tab 4/7: documented / community / inferred / unknown). */
export function ConfBadge({ c }: { c: Confidence }) {
  const x = CONF[c];
  return (
    <span className={x.cls} title={x.title}>
      {x.label}
    </span>
  );
}
