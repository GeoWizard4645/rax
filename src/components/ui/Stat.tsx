export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'amber' | 'blue' }) {
  const color = tone === 'emerald' ? 'text-emerald' : tone === 'amber' ? 'text-amber' : tone === 'blue' ? 'text-action' : 'text-head';
  return (
    <div className="panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num text-lg font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
