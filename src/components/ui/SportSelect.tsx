import type { Sport } from '../../types/real';

/** Pill row of sport filters. */
export function SportTabs<T extends string = Sport>({ sports, value, onChange, allLabel }: { sports: readonly T[]; value: T | 'ALL'; onChange: (s: T | 'ALL') => void; allLabel?: string }) {
  const items: Array<T | 'ALL'> = allLabel ? ['ALL', ...sports] : [...sports];
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sport">
      {items.map((s) => (
        <button
          key={s}
          role="tab"
          aria-selected={value === s}
          onClick={() => onChange(s)}
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors ${
            value === s ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:text-head hover:bg-hover'
          }`}
        >
          {s === 'ALL' ? allLabel : s}
        </button>
      ))}
    </div>
  );
}
