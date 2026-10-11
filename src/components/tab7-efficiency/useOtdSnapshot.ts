import { useAsync } from '../../lib/useAsync';
import type { OtdSnapshot } from '../../../shared/otdSnapshot';

export type OtdMethod = 'observed' | 'modeled';

const jobs = new Map<OtdMethod, Promise<OtdSnapshot>>();

/** Static snapshots built by scripts/build-otd-snapshot.mjs and scripts/build-modeled-snapshot.mjs (served from /data). */
export function fetchSnapshot(method: OtdMethod): Promise<OtdSnapshot> {
  let job = jobs.get(method);
  if (!job) {
    job = fetch(`/data/otd-${method}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`The ${method} snapshot isn't published yet (HTTP ${r.status}).`);
        return r.json() as Promise<OtdSnapshot>;
      })
      .catch((e) => {
        jobs.delete(method);
        throw e;
      });
    jobs.set(method, job);
  }
  return job;
}

export const useOtdSnapshot = (method: OtdMethod) => useAsync<OtdSnapshot>(() => fetchSnapshot(method), [method]);
