/** Runs the page tools the model asks for (shared/agent/clientTools.ts has their schemas). Everything goes through the bridge. */
import { resolveTab, tabById, type TabId } from '../../shared/agent/siteMap';
import { currentRoute, openTab, runAction, setParams, tabContext, undo } from './bridge';

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The tab the user means: an explicit id/route/name, else the one on screen. */
function pickTab(arg: unknown): TabId | null {
  if (typeof arg === 'string' && arg.trim()) return (resolveTab(arg) ?? tabById(arg))?.id ?? null;
  const here = [...['rateboard', 'scout', 'volatility', 'portfolio', 'quads', 'efficiency', 'calendar', 'edge'] as TabId[]].find((id) => currentRoute().startsWith(tabById(id)!.route));
  return here ?? null;
}

export async function executeClientTool(name: string, rawArgs: unknown): Promise<unknown> {
  const args = obj(rawArgs);
  switch (name) {
    case 'navigate': {
      const id = pickTab(args.tab);
      if (!id || typeof args.tab !== 'string') return { ok: false, error: 'Unknown tab. Use one of: rateboard, scout, volatility, portfolio, quads, efficiency, calendar, edge.' };
      const ok = await openTab(id);
      return { ok, route: tabById(id)!.route, note: ok ? 'Opened.' : 'The tab is taking a while to load.' };
    }
    case 'get_page_state': {
      const id = pickTab(args.tab);
      if (!id) return { ok: false, error: 'No tab specified and none is open.' };
      const ctx = tabContext(id, { full: true });
      return { ok: true, tab: id, open: ctx.active, ...ctx, note: ctx.active ? undefined : 'Tab is not open: values shown are from earlier this session or browser storage; parameter values are only live when the tab is open.' };
    }
    case 'set_params': {
      const id = pickTab(args.tab);
      if (!id) return { ok: false, error: 'Say which tab, or open one first.' };
      const values = obj(args.values);
      if (!Object.keys(values).length) return { ok: false, error: 'values is empty.' };
      const r = await setParams(id, values);
      return { ok: Object.keys(r.applied).length > 0, ...r };
    }
    case 'run_action': {
      const id = pickTab(args.tab);
      if (!id || typeof args.action !== 'string') return { ok: false, error: 'Give a tab and an action name.' };
      return runAction(id, args.action, obj(args.args));
    }
    case 'undo_last_change':
      return undo();
    default:
      return { ok: false, error: `Unknown page tool "${name}".` };
  }
}

/** Friendly one-liner for the "what I did" chips under a reply. */
export function describeStep(name: string, rawArgs: unknown, result: unknown): { label: string; ok: boolean } {
  const a = obj(rawArgs);
  const r = obj(result);
  const t = (typeof a.tab === 'string' ? tabById(a.tab) ?? resolveTab(a.tab) : undefined)?.label;
  const failed = r.ok === false || typeof r.error === 'string';
  switch (name) {
    case 'navigate': return { label: `Opened ${t ?? 'a tab'}`, ok: !failed };
    case 'get_page_state': return { label: `Read ${t ?? 'the current tab'}`, ok: !failed };
    case 'set_params': {
      const applied = obj(r.applied);
      const rej = Object.keys(obj(r.rejected));
      const bits = Object.entries(applied).map(([k, v]) => `${k} → ${Array.isArray(v) ? (v.length ? v.join(', ') : 'all') : String(v === '' ? 'today' : v)}`);
      return { label: bits.length ? `${t ?? 'Tab'}: ${bits.join(', ')}${rej.length ? ` (couldn't set ${rej.join(', ')})` : ''}` : `Couldn't change ${rej.join(', ') || 'anything'}`, ok: bits.length > 0 };
    }
    case 'run_action': return { label: `Ran ${String(a.action)}`, ok: !failed };
    case 'undo_last_change': return { label: 'Undid the last change', ok: r.ok === true };
    case 'search_docs': return { label: `Searched the docs: “${String(a.query ?? '').slice(0, 50)}”`, ok: !failed };
    case 'calculate': return { label: `Calculated ${String(a.expression ?? '').slice(0, 40)}`, ok: !failed };
    case 'live_odds': return { label: `Fetched ${String(a.sport ?? '')} odds`, ok: !failed };
    case 'schedule': return { label: 'Fetched the schedule', ok: !failed };
    case 'request_feature': return { label: 'Drafted an email to the developer', ok: !failed };
    case 'ev_calc': return { label: 'Computed EV', ok: !failed };
    case 'otd_payout': case 'otd_top_cards': case 'otd_rules': return { label: 'Used the OTD rules', ok: !failed };
    default: return { label: name.replace(/_/g, ' '), ok: !failed };
  }
}
