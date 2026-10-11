import type { OtdSport } from '../../../shared/otdSnapshot';
import type { EffState } from '../../components/tab7-efficiency/model';
import { effParams, effSummary } from '../effParams';
import { useAgentSurface } from '../useAgentSurface';

interface Args {
  s: EffState;
  set: (p: Partial<EffState>) => void;
  month: number; setMonth: (m: number) => void;
  year: number; setYear: (y: number) => void;
  firstYear: number; lastYear: number;
  claims: 2 | 3; setClaims: (c: 2 | 3) => void;
  source: 'mine' | 'best'; setSource: (s: 'mine' | 'best') => void;
  sportsSel: OtdSport[]; setSportsSel: (s: OtdSport[]) => void;
  ownedCards: number; shownCards: number;
  monthTotal: number; overlapDays: number;
  yearStats: { claimed: number; guaranteed: number; ceiling: number; waste: number };
}

/** Tab 8 (OTD Calendar): its own view settings plus the shared Tab 7 parameters. */
export function useCalendarSurface(a: Args) {
  const { s, set } = a;
  useAgentSurface('calendar', {
    summary: () => ({
      month: a.month, year: a.year, claims: a.claims, source: a.source, sports: a.sportsSel.length ? a.sportsSel : 'all',
      cardsOwned: a.ownedCards, cardsShown: a.shownCards, monthClaimableRax: Math.round(a.monthTotal), overlapDaysInMonth: a.overlapDays,
      yearClaimableRax: Math.round(a.yearStats.claimed), yearGuaranteedRax: Math.round(a.yearStats.guaranteed), yearCeilingRax: Math.round(a.yearStats.ceiling), yearWastedOnOverlapRax: Math.round(a.yearStats.waste),
      sharedWithTab7: effSummary(s),
    }),
    params: {
      ...effParams(s, set),
      month: { get: () => a.month, set: (v) => a.setMonth(v as number) },
      year: {
        get: () => a.year,
        set: (v) => {
          if ((v as number) < a.firstYear || (v as number) > a.lastYear) throw new Error(`year must be between ${a.firstYear} and ${a.lastYear}.`);
          a.setYear(v as number);
        },
      },
      claims: { get: () => String(a.claims), set: (v) => a.setClaims(Number(v) === 3 ? 3 : 2) },
      source: { get: () => a.source, set: (v) => a.setSource(v as 'mine' | 'best') },
      sports: { get: () => a.sportsSel, set: (v) => a.setSportsSel(v as OtdSport[]) },
    },
  });
}
