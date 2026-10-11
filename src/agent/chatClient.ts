/**
 * The assistant's conversation engine (no React): holds the transcript, talks to /api/chat over a streaming NDJSON response,
 * runs the page tools the model asks for, and falls back to the offline helper when the AI is unavailable.
 * The widget subscribes with useSyncExternalStore.
 */
import type { ChatMessage, ChatResponse, ToolCall } from '../../shared/agent/types';
import { resolveTab } from '../../shared/agent/siteMap';
import { describe as describeApp, note } from './bridge';
import { describeStep, executeClientTool } from './clientTools';
import { offlineReply } from './offline';
import { load, save } from '../lib/storage';

export interface Step {
  label: string;
  ok: boolean;
}
export interface UiMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  steps?: Step[];
  /** Produced by the offline helper rather than the AI model. */
  offline?: boolean;
  error?: boolean;
  ts: number;
}
export interface ChatState {
  msgs: UiMsg[];
  busy: boolean;
  status: string;
  mode: 'ai' | 'offline';
  /** Why we're offline, for the banner. */
  offlineReason?: string;
  budgetLeft?: number;
  open: boolean;
}

/**
 * Plain page commands ("set budget to 50k", "open the calendar") don't need a second model call just to say "done": when every
 * page tool succeeded and the request wasn't a question, we confirm locally. Saves ~3 s and ~40 free-tier neurons per command.
 */
const ACTION_ONLY = /^\s*(please\s+)?(set|change|make|switch|update|use|put|adjust|open|go to|take me|navigate|show me|undo|reset|raise|lower|increase|decrease)\b/i;
const NEEDS_THOUGHT = /\b(why|how|what|explain|tell me|compare|recommend|best|which|should)\b|\?/i;
const LOCAL_OK = new Set(['set_params', 'navigate', 'undo_last_change']);

function localConfirmation(calls: ToolCall[], results: unknown[]): string | null {
  if (!calls.length || !calls.every((c) => LOCAL_OK.has(c.function.name))) return null;
  if (!results.every((r) => (r as { ok?: boolean })?.ok === true)) return null;
  const parts: string[] = [];
  let changed = false;
  calls.forEach((c, i) => {
    const r = results[i] as { applied?: Record<string, unknown>; rejected?: Record<string, string>; tab?: string; route?: string; message?: string };
    if (c.function.name === 'navigate') parts.push(`Opened **${tabLabel(String((safeJson(c.function.arguments) as { tab?: string }).tab ?? ''))}**.`);
    else if (c.function.name === 'undo_last_change') parts.push(r.message ?? 'Undone.');
    else {
      changed = true;
      const ok = Object.entries(r.applied ?? {}).map(([k, v]) => `**${k}** → ${Array.isArray(v) ? (v.length ? v.join(', ') : 'all') : String(v === '' ? 'today' : v)}`);
      const bad = Object.entries(r.rejected ?? {}).map(([k, why]) => `${k}: ${why}`);
      parts.push(`Set on **${tabLabel(r.tab ?? '')}**: ${ok.join(', ')}.${bad.length ? ` I couldn't apply ${bad.join(' ')}` : ''}`);
    }
  });
  return `${parts.join(' ')}${changed ? ' Say “undo” to revert.' : ''}`;
}

const KEY = 'rax_chat_v1';
const MAX_ROUNDS = 6;
let wire: ChatMessage[] = [];
let state: ChatState = { msgs: [], busy: false, status: '', mode: 'ai', open: false };
let abort: AbortController | null = null;
let probed = false;
const listeners = new Set<() => void>();

const set = (p: Partial<ChatState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getState = () => state;

const tabLabel = (id: string) => resolveTab(id)?.label ?? id;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ------------------------------ persistence ------------------------------ */

function persist() {
  save(KEY, {
    msgs: state.msgs.slice(-40),
    wire: wire.slice(-24).map((m) => (m.role === 'tool' && (m.content?.length ?? 0) > 1200 ? { ...m, content: `${m.content!.slice(0, 1200)}…(truncated)` } : m)),
  });
}
(function restore() {
  const saved = load<{ msgs?: UiMsg[]; wire?: ChatMessage[] }>(KEY, {});
  if (Array.isArray(saved.msgs)) state = { ...state, msgs: saved.msgs.filter((m) => m && typeof m.text === 'string').slice(-40) };
  if (Array.isArray(saved.wire)) wire = saved.wire;
})();

export const setOpen = (open: boolean) => set({ open });

export function clear() {
  abort?.abort();
  wire = [];
  set({ msgs: [], busy: false, status: '' });
  persist();
}

/** One cheap GET so the widget can show "AI" vs "offline" before the first message. */
export async function probe(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    const r = await fetch('/api/chat');
    const j = (await r.json()) as { ai?: boolean; budgetLeft?: number };
    if (!j.ai) set({ mode: 'offline', offlineReason: 'The AI model is not enabled on this deployment.' });
    else if ((j.budgetLeft ?? 1) <= 0.015) set({ mode: 'offline', offlineReason: "Today's free AI allowance is used up (resets 00:00 UTC).", budgetLeft: 0 });
    else set({ mode: 'ai', offlineReason: undefined, budgetLeft: j.budgetLeft });
  } catch {
    /* offline or dev server without functions: first message will tell us */
  }
}

/* -------------------------------- transport ------------------------------ */

async function post(signal: AbortSignal, onStatus: (s: string) => void): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ messages: wire.slice(-30), context: describeApp() }),
  });
  if (res.status === 404 || res.status === 405) return { ok: false, code: 'ai_unavailable', message: 'The assistant service is not available here.' };
  if (!(res.headers.get('content-type') ?? '').includes('ndjson') || !res.body) return (await res.json()) as ChatResponse;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done: ChatResponse | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as { t: string; text?: string; res?: ChatResponse };
        if (ev.t === 'status' && ev.text) onStatus(ev.text);
        else if (ev.t === 'done' && ev.res) done = ev.res;
      } catch {
        /* ignore a torn line */
      }
    }
    if (end) break;
  }
  return done ?? { ok: false, code: 'model_error', message: 'The connection dropped before the answer finished.' };
}

/* --------------------------------- sending ------------------------------- */

const pushMsg = (m: Omit<UiMsg, 'id' | 'ts'>) => set({ msgs: [...state.msgs, { ...m, id: uid(), ts: Date.now() }] });

async function viaOffline(text: string, reason?: string) {
  set({ mode: 'offline', offlineReason: reason ?? state.offlineReason, status: 'Working offline…' });
  const r = await offlineReply(text);
  wire.push({ role: 'user', content: text }, { role: 'assistant', content: r.text });
  pushMsg({ role: 'assistant', text: r.text, steps: r.steps, offline: true });
}

export async function send(text: string): Promise<void> {
  const t = text.trim().slice(0, 1500);
  if (!t || state.busy) return;
  abort = new AbortController();
  const signal = abort.signal;
  set({ busy: true, status: 'Thinking…' });
  pushMsg({ role: 'user', text: t });
  note(`asked the assistant: “${t.slice(0, 60)}”`);
  const steps: Step[] = [];
  const startLen = wire.length;
  try {
    if (state.mode === 'offline') {
      // retry the AI occasionally: the allowance resets at 00:00 UTC
      probed = false;
      await probe();
    }
    if (state.mode === 'offline') {
      await viaOffline(t);
      return;
    }
    wire.push({ role: 'user', content: t });
    let final: string | null = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await post(signal, (s) => set({ status: s }));
      if (!res.ok) {
        wire.length = startLen; // drop the unanswered turn from the wire history; the offline helper re-adds it
        if (res.code === 'rate_limited') {
          pushMsg({ role: 'assistant', text: res.message, error: true });
          return;
        }
        await viaOffline(t, res.code === 'budget' ? "Today's free AI allowance is used up (resets 00:00 UTC)." : res.code === 'ai_unavailable' ? res.message : 'The AI model had a problem, so I switched to offline mode.');
        return;
      }
      wire.push(...res.messages);
      set({ budgetLeft: res.budgetLeft, mode: 'ai', offlineReason: undefined });
      // server-side tool results (docs, maths, …) arrive as tool messages next to their calls: turn them into chips
      const byId = new Map(res.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
      for (const m of res.messages) {
        for (const c of m.tool_calls ?? []) {
          const tm = byId.get(c.id);
          if (tm) {
            let result: unknown;
            try { result = JSON.parse(tm.content ?? '{}'); } catch { result = {}; }
            steps.push(describeStep(c.function.name, safeJson(c.function.arguments), result));
          }
        }
      }
      if (res.type === 'message') {
        final = res.messages[res.messages.length - 1]?.content ?? '';
        break;
      }
      const results: unknown[] = [];
      for (const call of res.calls ?? []) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        set({ status: statusFor(call) });
        const args = safeJson(call.function.arguments);
        let result: unknown;
        try {
          result = await executeClientTool(call.function.name, args);
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : 'failed' };
        }
        results.push(result);
        steps.push(describeStep(call.function.name, args, result));
        wire.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, 3500) });
      }
      const lastAssistant = res.messages.filter((m) => m.role === 'assistant').pop();
      if (round === 0 && !lastAssistant?.content && ACTION_ONLY.test(t) && !NEEDS_THOUGHT.test(t)) {
        const text = localConfirmation(res.calls ?? [], results);
        if (text) {
          wire.push({ role: 'assistant', content: text });
          final = text;
          break;
        }
      }
    }
    pushMsg({ role: 'assistant', text: final ?? 'I got stuck going back and forth with the page — could you rephrase or ask for one thing at a time?', steps });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      wire.length = startLen;
      pushMsg({ role: 'assistant', text: 'Stopped.', steps });
    } else {
      wire.length = startLen;
      await viaOffline(t, 'I could not reach the assistant service, so I switched to offline mode.');
    }
  } finally {
    abort = null;
    set({ busy: false, status: '' });
    persist();
  }
}

export const stop = () => abort?.abort();

function safeJson(s: string): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}
function statusFor(c: ToolCall): string {
  switch (c.function.name) {
    case 'navigate': return 'Opening the tab…';
    case 'set_params': return 'Changing settings…';
    case 'get_page_state': return 'Reading the page…';
    case 'run_action': return 'Running the action…';
    default: return 'Working…';
  }
}
