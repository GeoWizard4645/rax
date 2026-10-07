import { useMemo } from 'react';
import { getJson } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { indexFighters, type UfcPayload } from '../../shared/ufc';

/** UFC fighter metadata from Rateboard's public /api/ufc (via our proxy). Only fetched when `enabled`. */
export function useUfc(enabled: boolean) {
  const r = useAsync<UfcPayload>((signal) => getJson('/api/proxy/rateboard?path=api/ufc', signal), [], enabled);
  const index = useMemo(() => indexFighters(r.data), [r.data]);
  return { ...r, index };
}
