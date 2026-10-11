/**
 * The page ↔ assistant bridge. A module-level singleton (not React state) so the chat widget, the tabs and the tests all see
 * one source of truth without re-rendering the whole tree.
 *
 *  - Each tab registers a *binding* (`useAgentSurface`): a summary of what it holds plus getters/setters for the parameters
 *    declared in catalog.ts. Bindings are held by ref, so the assistant always acts on the tab's latest closures.
 *  - `describe()` is what the assistant "sees": every tab's state (live, last-seen, or from browser storage) + an activity log.
 *  - `setParams()` validates, navigates to the tab if needed, applies, remembers the old values for `undo()`, and reports back.
 *  - Changes the USER makes are noticed too (`noteRender`), so the activity log covers both sides.
 */
import type { AgentActionSpec, AgentContext, AgentParamSpec, AgentTabContext } from '../../shared/agent/types';
import { SITE_TABS, tabById, type TabId } from '../../shared/agent/siteMap';
import { ACTION_CATALOG, PARAM_CATALOG, type ParamMeta } from './catalog';
import { coerceParam } from './coerce';
import { persistedSummary } from './persisted';

export type { TabId };

export interface Accessor {
  get(): unknown;
  set(v: unknown): void;
}
export interface SurfaceBinding {
  /** Compact JSON-able description of what the tab holds + its headline results. Called on demand. */
  summary(): unknown;
  params: Record<string, Accessor>;
  actions?: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>;
}
type Ref = { current: SurfaceBinding };

const live = new Map<TabId, Ref>();
const frozen = new Map<TabId, unknown>();
const seen = new Set<TabId>();
const lastValues = new Map<TabId, Record<string, string>>();
const activity: string[] = [];
const undoStack: Array<{ tab: TabId; before: Record<string, unknown>; label: string }> = [];
let route = '/';
let navigator_: ((to: string) => void) | null = null;
let assistantWriting = false;
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getVersion = () => version;

const safe = <T,>(f: () => T, fb: T): T => {
  try {
    return f();
  } catch {
    return fb;
  }
};
const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

function log(line: string) {
  const prev = activity[activity.length - 1];
  // typing "5","50","500" shouldn't flood the log: same parameter changed again → replace
  const key = (s: string) => s.replace(/→.*$/, '');
  if (prev && key(prev) === key(line) && !line.includes('(assistant)')) activity[activity.length - 1] = line;
  else activity.push(line);
  if (activity.length > 40) activity.shift();
  emit();
}

/* ------------------------------ registration ----------------------------- */

export function registerSurface(id: TabId, ref: Ref): () => void {
  live.set(id, ref);
  seen.add(id);
  lastValues.set(id, snapshotValues(ref.current));
  emit();
  return () => {
    if (live.get(id) === ref) {
      frozen.set(id, safe(() => ref.current.summary(), undefined));
      live.delete(id);
      emit();
    }
  };
}

function snapshotValues(b: SurfaceBinding): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, a] of Object.entries(b.params)) out[k] = JSON.stringify(safe(() => a.get(), null));
  return out;
}

/** Called from the tab's effect after each render: log anything the *user* changed since last time. */
export function noteRender(id: TabId): void {
  const ref = live.get(id);
  if (!ref) return;
  const now = snapshotValues(ref.current);
  const before = lastValues.get(id) ?? now;
  lastValues.set(id, now);
  if (assistantWriting) return;
  const tab = tabById(id);
  for (const k of Object.keys(now)) {
    if (now[k] !== before[k]) log(`You set ${tab ? `Tab ${tab.n}` : id} ${k} → ${show(safe(() => JSON.parse(now[k]), now[k]))}`);
  }
}

export function setNavigator(fn: ((to: string) => void) | null) {
  navigator_ = fn;
}

export function noteRoute(pathname: string): void {
  if (pathname === route) return;
  route = pathname;
  const t = SITE_TABS.find((x) => pathname.startsWith(x.route));
  if (t) log(`opened Tab ${t.n} (${t.label})`);
  else emit();
}

export const currentRoute = () => route;
const isActive = (id: TabId) => !!tabById(id) && route.startsWith(tabById(id)!.route);

export function note(line: string) {
  log(line);
}

/* -------------------------------- describing ----------------------------- */

const withValues = (id: TabId): AgentParamSpec[] => {
  const b = live.get(id)?.current;
  return PARAM_CATALOG[id].map((m): AgentParamSpec => ({ ...m, value: b?.params[m.name] ? safe(() => b.params[m.name].get(), undefined) : undefined }));
};

export function tabContext(id: TabId, opts: { full?: boolean } = {}): AgentTabContext {
  const t = tabById(id)!;
  const b = live.get(id)?.current;
  const active = isActive(id);
  const summary = b ? safe(() => b.summary(), undefined) : frozen.has(id) ? frozen.get(id) : safe(() => persistedSummary(id), undefined);
  const ctx: AgentTabContext = { id, label: t.label, route: t.route, active, seen: seen.has(id), summary };
  if ((active || opts.full) && b) {
    ctx.params = withValues(id);
    ctx.actions = (ACTION_CATALOG[id] ?? []).filter((a) => !!b.actions?.[a.name]);
  } else if (opts.full) {
    ctx.params = PARAM_CATALOG[id].map((m) => ({ ...m }));
    ctx.actions = ACTION_CATALOG[id];
  }
  return ctx;
}

export function describe(): AgentContext {
  return {
    route,
    now: new Date().toISOString(),
    tabs: SITE_TABS.map((t) => tabContext(t.id)).filter((t) => t.active || t.seen || t.summary !== undefined),
    activity: activity.slice(-16),
  };
}

/* --------------------------------- acting -------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function openTab(id: TabId, timeoutMs = 6000): Promise<boolean> {
  const t = tabById(id);
  if (!t) return false;
  if (live.has(id) && isActive(id)) return true;
  navigator_?.(t.route);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (live.has(id) && isActive(id)) {
      await sleep(30);
      return true;
    }
    await sleep(40);
  }
  return live.has(id);
}

const matchName = (name: string, metas: ParamMeta[]): ParamMeta | undefined => {
  const n = name.toLowerCase().replace(/[\s_\-]+/g, '');
  return metas.find((m) => m.name.toLowerCase() === n || m.name.toLowerCase().replace(/[\s_\-]+/g, '') === n);
};

export interface SetResult {
  tab: TabId;
  applied: Record<string, unknown>;
  rejected: Record<string, string>;
  current: Record<string, unknown>;
}

export async function setParams(id: TabId, values: Record<string, unknown>, who: 'assistant' | 'user-command' = 'assistant'): Promise<SetResult> {
  const metas = PARAM_CATALOG[id];
  const applied: Record<string, unknown> = {};
  const rejected: Record<string, string> = {};
  const todo: Array<[ParamMeta, unknown]> = [];
  for (const [k, raw] of Object.entries(values ?? {})) {
    const meta = matchName(k, metas);
    if (!meta) {
      rejected[k] = `Unknown parameter on ${tabById(id)?.label}. Valid: ${metas.map((m) => m.name).join(', ')}.`;
      continue;
    }
    const c = coerceParam(meta, raw);
    if (c.ok) todo.push([meta, c.value]);
    else rejected[k] = c.reason;
  }
  if (todo.length) {
    if (!(await openTab(id))) {
      for (const [m] of todo) rejected[m.name] = 'Could not open the tab to apply this.';
      todo.length = 0;
    }
  }
  const b = live.get(id)?.current;
  const before: Record<string, unknown> = {};
  assistantWriting = true;
  try {
    // order matters when one value gates another (e.g. timeframe=custom before customDays): apply in the order given
    for (const [meta, value] of todo) {
      const acc = b?.params[meta.name];
      if (!acc) {
        rejected[meta.name] = 'This tab does not expose that parameter right now.';
        continue;
      }
      before[meta.name] = safe(() => acc.get(), undefined);
      try {
        acc.set(value);
        applied[meta.name] = value;
      } catch (e) {
        rejected[meta.name] = e instanceof Error ? e.message : 'Could not apply.';
      }
    }
    await sleep(80); // let React commit so we read back the real values
  } finally {
    assistantWriting = false;
  }
  const t = tabById(id)!;
  if (Object.keys(applied).length) {
    undoStack.push({ tab: id, before, label: `Tab ${t.n}: ${Object.keys(applied).join(', ')}` });
    if (undoStack.length > 15) undoStack.shift();
    log(`${who === 'assistant' ? 'assistant' : 'chat command'} set Tab ${t.n} ${Object.entries(applied).map(([k, v]) => `${k} → ${show(v)}`).join(', ')} (assistant)`);
  }
  if (live.has(id)) lastValues.set(id, snapshotValues(live.get(id)!.current));
  const current: Record<string, unknown> = {};
  const nb = live.get(id)?.current;
  for (const k of new Set([...Object.keys(applied), ...Object.keys(rejected).map((r) => matchName(r, metas)?.name ?? r)])) if (nb?.params[k]) current[k] = safe(() => nb.params[k].get(), undefined);
  return { tab: id, applied, rejected, current };
}

export async function undo(): Promise<{ ok: boolean; message: string; restored?: Record<string, unknown> }> {
  const last = undoStack.pop();
  if (!last) return { ok: false, message: 'Nothing to undo.' };
  const res = await setParams(last.tab, last.before, 'user-command');
  undoStack.pop(); // the undo itself must not be undoable
  log(`undid ${last.label}`);
  return { ok: true, message: `Restored ${last.label}.`, restored: res.applied };
}

export const canUndo = () => undoStack.length > 0;

export async function runAction(id: TabId, action: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; message: string; result?: unknown }> {
  const spec: AgentActionSpec | undefined = (ACTION_CATALOG[id] ?? []).find((a) => a.name === action);
  if (!spec) return { ok: false, message: `Unknown action "${action}" on ${tabById(id)?.label}. Available: ${(ACTION_CATALOG[id] ?? []).map((a) => a.name).join(', ') || 'none'}.` };
  if (!(await openTab(id))) return { ok: false, message: 'Could not open the tab.' };
  const fn = live.get(id)?.current.actions?.[action];
  if (!fn) return { ok: false, message: 'That action is not available right now.' };
  try {
    const result = await fn(args);
    log(`assistant ran ${action} on Tab ${tabById(id)!.n} (assistant)`);
    return { ok: true, message: 'Done.', result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'The action failed.' };
  }
}

/** Test helper. */
export const __reset = () => {
  live.clear(); frozen.clear(); seen.clear(); lastValues.clear(); activity.length = 0; undoStack.length = 0; route = '/'; navigator_ = null; assistantWriting = false;
};
