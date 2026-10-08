import type { PlayerStat } from '../../../shared/rax';

const n = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k` : v.toLocaleString());

/** Owners + season Rax beside a player, as Rateboard shows them (from its Rax logs). */
export default function StatChips({ stat }: { stat: PlayerStat | undefined }) {
  if (!stat || (stat.rax == null && stat.owners == null)) return null;
  return (
    <span className="ml-1.5 text-[11px] font-normal text-muted" title="Owners and season Rax, from Rateboard's Rax logs">
      {stat.owners != null && <span><b className="text-head">{n(stat.owners)}</b> owners</span>}
      {stat.owners != null && stat.rax != null && ' · '}
      {stat.rax != null && <span><b className="text-head">{n(stat.rax)}</b> rax</span>}
    </span>
  );
}
