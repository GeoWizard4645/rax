/**
 * The tools that act on the PAGE. The model is told about them (these schemas go into the chat request) but they run in the
 * browser (src/agent/clientTools.ts), because only the browser holds the tabs' state. None of them can sign in, post or remove
 * Rateboard offers, spend anything or leave the site — they move around and change calculator inputs, and every change is undoable.
 */
import type { JsonSchema } from './tools';
import { TAB_IDS } from './siteMap';

export interface ClientToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export const CLIENT_TOOLS: ClientToolSpec[] = [
  {
    name: 'navigate',
    description: 'Open a tab of the site.',
    inputSchema: { type: 'object', properties: { tab: { type: 'string', enum: TAB_IDS, description: 'Tab id.' } }, required: ['tab'], additionalProperties: false },
  },
  {
    name: 'get_page_state',
    description: "Read a tab's current inputs, its settable parameters (names, allowed values, current values), its actions and the headline results it computed. Omit tab for the one on screen. Call this before set_params if you don't know a parameter's exact name.",
    inputSchema: { type: 'object', properties: { tab: { type: 'string', enum: TAB_IDS } }, additionalProperties: false },
  },
  {
    name: 'set_params',
    description: 'Change one or more parameters on a tab (opens the tab first if needed). Values are validated; the result lists what was applied and what was rejected and why. Use exact parameter names from the page context or get_page_state.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: TAB_IDS },
        values: { type: 'object', description: 'Map of parameter name → new value, e.g. {"rarity":"Iconic","budget":50000,"sports":["NFL"]}.' },
      },
      required: ['values'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_action',
    description: 'Run a named action on a tab (see the tab\'s actions list), e.g. pull the user\'s collection on the Scout tab. Only safe, read-only actions exist.',
    inputSchema: {
      type: 'object',
      properties: { tab: { type: 'string', enum: TAB_IDS }, action: { type: 'string' }, args: { type: 'object' } },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo_last_change',
    description: 'Undo the most recent set_params change made by the assistant (restores the previous values).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));
