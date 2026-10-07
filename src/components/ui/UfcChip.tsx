import { ufcStatus, type UfcFighter } from '../../../shared/ufc';

const STATUS_CHIP = { active: 'chip-emerald', inactive: 'chip-amber', retired: 'chip-muted', unknown: 'chip-muted' } as const;

/** Fighter status from Rateboard's public /api/ufc (UFC.com data): active / inactive / retired, details on hover. */
export default function UfcChip({ f }: { f: UfcFighter }) {
  const st = ufcStatus(f.status);
  const label = st === 'unknown' ? f.status || '—' : st;
  const tip = [f.division, f.record, f.age && `age ${f.age}`, f.lastFight && `last fight ${f.lastFight}`, f.nextFight && `next ${f.nextFight}`].filter(Boolean).join(' · ');
  return (
    <span className={STATUS_CHIP[st]} title={tip}>
      {label}
    </span>
  );
}
