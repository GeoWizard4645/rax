/**
 * UFC fighter metadata from Rateboard's public `/api/ufc` (sourced by Rateboard from UFC.com).
 * Status strings arrive in whatever language UFC.com served ("Aktiv", "Im Ruhestand", …), so they are normalised here.
 */
import { normSuffix } from './rateboard';

export interface UfcFighter {
  status: string;
  age: string;
  record: string;
  division: string;
  ufcName?: string;
  /** YYYY-MM-DD or "". */
  lastFight: string;
  nextFight: string;
}

export interface UfcPayload {
  fighters: Record<string, UfcFighter>;
  updated?: number;
}

export type UfcStatus = 'active' | 'inactive' | 'retired' | 'unknown';

const STATUS: Array<[RegExp, UfcStatus]> = [
  [/^(active|aktiv)$/i, 'active'],
  [/^(retired|im ruhestand)$/i, 'retired'],
  [/^(not fighting|nicht kämpfen|released)$/i, 'inactive'],
];

export function ufcStatus(raw: string | undefined): UfcStatus {
  const s = (raw || '').trim();
  return STATUS.find(([re]) => re.test(s))?.[1] ?? 'unknown';
}

/** Index fighters by suffix-sensitive normalised name, so "Sean O'Malley" finds "Sean O'Malley". */
export function indexFighters(p: UfcPayload | null | undefined): Map<string, UfcFighter> {
  const m = new Map<string, UfcFighter>();
  for (const [name, f] of Object.entries(p?.fighters ?? {})) {
    if (f && typeof f === 'object') m.set(normSuffix(f.ufcName || name), f);
  }
  return m;
}

export const findFighter = (idx: Map<string, UfcFighter>, player: string) => idx.get(normSuffix(player)) ?? null;
