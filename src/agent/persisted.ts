/**
 * What the assistant can know about a tab the user hasn't opened since loading the page: the inputs that tab persisted in
 * localStorage. Read lazily (only when a chat message is sent) and summarised — never raw blobs, never credentials.
 */
import type { TabId } from '../../shared/agent/siteMap';
import { load } from '../lib/storage';

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : {});
const count = (x: unknown) => (Array.isArray(x) ? x.length : Object.keys(rec(x)).length);

export function persistedSummary(id: TabId): unknown | undefined {
  switch (id) {
    case 'efficiency':
    case 'calendar': {
      const s = rec(load<unknown>('rax_eff_state_v1', {}));
      if (!Object.keys(s).length) return undefined;
      return {
        fromBrowserStorage: true,
        method: s.method, timeframe: s.preset, rarity: s.rarity, budget: s.budget, maxCards: s.maxCards, ratePerRating: s.rate, sports: count(s.sports) ? s.sports : 'all',
        ownedCards: count(s.ownedLevels), customCards: count(s.customCards), priceOverrides: count(s.overrides), username: s.username || undefined,
      };
    }
    case 'edge': {
      const s = rec(load<unknown>('rax_edge_v1', {}));
      if (!Object.keys(s).length) return undefined;
      const rules = rec(s.rules);
      return { fromBrowserStorage: true, sport: s.sport, bankroll: s.bankroll, kellyFraction: s.fraction, devig: s.devig, rakePct: typeof rules.rake === 'number' ? rules.rake * 100 : undefined, savedRealPercentEntries: count(s.entries) };
    }
    case 'rateboard': {
      const sport = load<string | null>('rax_rb_sport', null);
      return sport ? { fromBrowserStorage: true, sport, excludedPlayers: count(load<unknown>('rax_rb_exclude_v1', [])) } : undefined;
    }
    case 'quads': {
      const n = count(load<unknown>('rax_squad_board_v1', []));
      return n ? { fromBrowserStorage: true, squadBoardEntries: n } : undefined;
    }
    case 'portfolio': {
      const n = count(load<unknown>('rax_audit_rows_v1', []));
      return n ? { fromBrowserStorage: true, auditRows: n } : undefined;
    }
    default:
      return undefined;
  }
}
