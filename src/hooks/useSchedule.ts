import { getJson } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import type { QuadGame } from '../../shared/sample';

export interface ScheduleData {
  source: 'live' | 'sample';
  generatedAt: string;
  games: QuadGame[];
  note?: string;
}

/** Real upcoming/live games (ESPN public scoreboards via the edge), refreshed on demand. */
export const useSchedule = () => useAsync<ScheduleData>((signal) => getJson('/api/intel/schedule?days=4', signal), []);
