import type { Accessor } from './bridge';
import type { EffState } from '../components/tab7-efficiency/model';

/** Tabs 7 and 8 share one persisted EffState; this maps the assistant's parameter names onto it. */
export function effParams(s: EffState, set: (p: Partial<EffState>) => void): Record<string, Accessor> {
  const pct = (x: number) => Math.round(x * 1000) / 10;
  return {
    method: { get: () => s.method, set: (v) => set({ method: v as EffState['method'] }) },
    timeframe: { get: () => s.preset, set: (v) => set({ preset: v as EffState['preset'] }) },
    customDays: { get: () => s.customDays, set: (v) => set({ customDays: v as number, preset: 'custom' }) },
    startDate: { get: () => s.start, set: (v) => set({ start: v as string }) },
    capLifetime: { get: () => s.capLifetime, set: (v) => set({ capLifetime: v as boolean }) },
    proBonusWinPct: { get: () => pct(s.proWin), set: (v) => set({ proWin: (v as number) / 100 }) },
    rarity: { get: () => s.rarity, set: (v) => set({ rarity: v as string }) },
    autoMinRarity: { get: () => s.autoMin, set: (v) => set({ autoMin: v as string }) },
    multiplierOverride: { get: () => s.multOverride, set: (v) => set({ multOverride: v as number }) },
    sports: { get: () => (s.sports.length ? s.sports : []), set: (v) => set({ sports: v as EffState['sports'] }) },
    budget: { get: () => s.budget, set: (v) => set({ budget: v as number }) },
    maxCards: { get: () => s.maxCards, set: (v) => set({ maxCards: v as number }) },
    minReturnPct: { get: () => pct(s.minRoi), set: (v) => set({ minRoi: (v as number) / 100 }) },
    hold: { get: () => s.hold, set: (v) => set({ hold: v as EffState['hold'] }) },
    flipLossPct: { get: () => pct(s.flipLoss), set: (v) => set({ flipLoss: (v as number) / 100 }) },
    overlapMode: { get: () => s.overlapMode, set: (v) => set({ overlapMode: v as EffState['overlapMode'] }) },
    ratePerRating: { get: () => s.rate, set: (v) => set({ rate: v as number }) },
  };
}

/** The inputs worth telling the assistant about, in the same names it can set them by. */
export function effSummary(s: EffState) {
  return {
    method: s.method, timeframe: s.preset, customDays: s.preset === 'custom' ? s.customDays : undefined, startDate: s.start || 'today', capLifetime: s.capLifetime,
    proBonusWinPct: Math.round(s.proWin * 100), rarity: s.rarity, autoMinRarity: s.rarity === 'AUTO' ? s.autoMin : undefined, multiplierOverride: s.multOverride || undefined,
    sports: s.sports.length ? s.sports : 'all', budget: s.budget, maxCards: s.maxCards, minReturnPct: Math.round(s.minRoi * 100), hold: s.hold,
    flipLossPct: s.hold === 'flip' ? Math.round(s.flipLoss * 100) : undefined, overlapMode: s.overlapMode, ratePerRating: s.rate,
    ownedCards: Object.keys(s.ownedLevels).length, priceOverrides: Object.keys(s.overrides).length, username: s.username || undefined,
  };
}
