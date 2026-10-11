/** Wire types shared by the browser (src/agent), the chat endpoint (functions/api/chat.ts) and the offline helper. */

export type ParamType = 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'string[]' | 'date';

/** One thing the assistant may change on a tab. `value` is the current value (filled in by the browser when describing). */
export interface AgentParamSpec {
  name: string;
  type: ParamType;
  description: string;
  /** enum members, or the allowed members of a string[] */
  values?: string[];
  min?: number;
  max?: number;
  /** Current value (JSON-serialisable). */
  value?: unknown;
}

export interface AgentActionSpec {
  name: string;
  description: string;
  args?: Array<{ name: string; type: 'string' | 'number'; description: string; required?: boolean }>;
}

export interface AgentTabContext {
  id: string;
  label: string;
  route: string;
  /** Currently on screen. */
  active: boolean;
  /** Seen at some point this session (state may be from an earlier visit). */
  seen: boolean;
  /** What the tab holds right now: inputs, selections and the headline numbers it computed. */
  summary?: unknown;
  /** Settable parameters — sent in full for the active tab only. */
  params?: AgentParamSpec[];
  actions?: AgentActionSpec[];
}

export interface AgentContext {
  route: string;
  /** ISO time on the user's device. */
  now: string;
  tabs: AgentTabContext[];
  /** Newest last: "set Tab 7 rarity → Iconic (by assistant)", "opened Tab 9", … */
  activity: string[];
}

/** OpenAI-style chat message, as exchanged with Workers AI and stored in the browser. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  context: AgentContext;
}

export type ChatResponse =
  | {
      ok: true;
      /** 'message': the assistant is done (last element of `messages` is its reply). 'tool_calls': run `calls` in the browser and call again. */
      type: 'message' | 'tool_calls';
      /** New messages to append to the history, in order. */
      messages: ChatMessage[];
      calls?: ToolCall[];
      model: string;
      /** Rough share of today's free AI allowance left (0–1), for the UI. */
      budgetLeft?: number;
    }
  | { ok: false; code: 'budget' | 'rate_limited' | 'ai_unavailable' | 'bad_request' | 'model_error'; message: string; retryAfter?: number };
