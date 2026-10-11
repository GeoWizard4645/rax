import { useEffect, useRef } from 'react';
import { noteRender, registerSurface, type SurfaceBinding, type TabId } from './bridge';

/**
 * Let the assistant see and drive a tab. Call once in the tab's root component with the tab's current state:
 *
 *   useAgentSurface('edge', {
 *     summary: () => ({ sport: s.sport, bankroll: s.bankroll, … }),
 *     params: { bankroll: { get: () => s.bankroll, set: (v) => set({ bankroll: v as number }) }, … },
 *   });
 *
 * The binding is read through a ref, so it always reflects the latest render without re-registering. Parameter names must
 * match src/agent/catalog.ts, which is where their types and allowed values are declared and validated.
 */
export function useAgentSurface(id: TabId, binding: SurfaceBinding): void {
  const ref = useRef(binding);
  ref.current = binding;
  useEffect(() => registerSurface(id, ref), [id]);
  useEffect(() => noteRender(id)); // after every render: notice changes the user made
}
