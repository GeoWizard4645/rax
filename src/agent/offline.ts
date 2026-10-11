/**
 * The assistant without the AI: used when today's free Workers AI allowance is spent (or the model is unreachable).
 * Deterministic and honest about being simple — it can navigate, change parameters from "set X to Y" phrasing, undo,
 * do arithmetic, and answer questions by showing the best-matching passages from Real's docs and the site guide.
 */
import { evaluate } from '../../shared/agent/calc';
import { resolveTab, SITE_TABS, type TabId } from '../../shared/agent/siteMap';
import { currentRoute, setParams, undo } from './bridge';
import { PARAM_CATALOG, type ParamMeta } from './catalog';
import { executeClientTool } from './clientTools';

export interface OfflineResult {
  text: string;
  steps: Array<{ label: string; ok: boolean }>;
}

const camelWords = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const ALIASES: Record<string, string[]> = {
  rarity: ['rarity', 'level', 'tier'], budget: ['budget', 'spend'], timeframe: ['timeframe', 'time frame', 'window', 'period', 'days'], sports: ['sports', 'sport'],
  maxCards: ['max cards', 'number of cards', 'cards'], ratePerRating: ['rate per rating', 'rate', 'price per rating'], bankroll: ['bankroll'], kellyFraction: ['kelly fraction', 'kelly'],
  rakePct: ['rake', 'fee'], devig: ['devig', 'de-vig', 'vig method'], proBonusWinPct: ['pro bonus', 'pro win', 'bonus win'], hold: ['hold', 'holding'],
  minReturnPct: ['min return', 'minimum return'], startDate: ['start', 'start date', 'starting'], view: ['view', 'panel'], username: ['username', 'user name', 'user'],
};

function aliasesOf(m: ParamMeta): string[] {
  return [...new Set([camelWords(m.name), ...(ALIASES[m.name] ?? [])])].sort((a, b) => b.length - a.length);
}

/** "set rarity to Iconic and budget to 50k" → { rarity: 'Iconic', budget: '50k' } for the given tab's parameters. */
export function parseAssignments(text: string, metas: ParamMeta[]): Record<string, string> {
  const out: Record<string, string> = {};
  const lower = text.toLowerCase();
  const hits: Array<{ meta: ParamMeta; start: number; end: number }> = [];
  for (const meta of metas) {
    for (const al of aliasesOf(meta)) {
      const re = new RegExp(`\\b${al.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b\\s*(?:to|=|:|as|at|of|is|→)?\\s*`, 'i');
      const m = re.exec(lower);
      if (m && !hits.some((h) => h.start === m.index)) {
        hits.push({ meta, start: m.index, end: m.index + m[0].length });
        break;
      }
    }
  }
  hits.sort((a, b) => a.start - b.start);
  hits.forEach((h, i) => {
    const next = hits[i + 1]?.start ?? text.length;
    const raw = text.slice(h.end, next).replace(/\b(and|then|also|,|;)\s*$/i, '').replace(/[.,;]+\s*$/, '').replace(/\s+(and|,)\s*$/i, '').trim();
    if (raw) out[h.meta.name] = raw.replace(/^(the|a|an)\s+/i, '');
  });
  return out;
}

const NAV = /\b(go to|open|take me to|show me|switch to|navigate to|bring up)\b/i;
const SET = /\b(set|change|make|switch|update|use|put|adjust|raise|lower|increase|decrease)\b/i;
const MATH = /(\d+(?:\.\d+)?)\s*%\s*of\s*\$?([\d,]+(?:\.\d+)?[km]?)/i;

async function searchDocs(q: string): Promise<OfflineResult> {
  try {
    const r = await fetch(`/api/docs/search?q=${encodeURIComponent(q)}&limit=3`);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { results: Array<{ title: string; section: string; url: string; text: string }> };
    if (!j.results.length) return { text: "I couldn't find anything about that in the docs. Try different keywords, or ask again after the AI allowance resets (00:00 UTC).", steps: [] };
    const body = j.results.map((x) => `**${x.section}** — [${x.title}](${x.url})\n${x.text.slice(0, 420).trim()}${x.text.length > 420 ? '…' : ''}`).join('\n\n');
    return { text: `Here's what the docs say (I'm in offline mode, so these are the closest passages rather than a written answer):\n\n${body}`, steps: [{ label: `Searched the docs: “${q.slice(0, 50)}”`, ok: true }] };
  } catch {
    return { text: "I can't reach the docs search right now. Check your connection and try again.", steps: [] };
  }
}

export async function offlineReply(text: string): Promise<OfflineResult> {
  const t = text.trim();
  const steps: OfflineResult['steps'] = [];
  if (/^\s*(undo|revert|go back)( that| the last change)?[.!]*\s*$/i.test(t)) {
    const r = await undo();
    return { text: r.message, steps: [{ label: 'Undid the last change', ok: r.ok }] };
  }
  if (/^\s*(hi|hello|hey|help)\b/i.test(t) || t.length < 2) {
    return { text: "I'm in offline mode (today's free AI allowance is used up, it resets at 00:00 UTC). I can still: **open a tab** (\"open the OTD calendar\"), **change settings** (\"set rarity to Epic and budget to 50k\"), **do quick maths** (\"15% of 2,000\"), **undo**, and **look things up** in Real's docs and the site guide.", steps };
  }
  const m = MATH.exec(t);
  if (m) {
    const base = evaluate(m[2].replace(/k$/i, '*1000').replace(/m$/i, '*1000000'));
    return { text: `${m[1]}% of ${m[2]} = **${Math.round(base * Number(m[1])) / 100}**`, steps: [{ label: 'Calculated', ok: true }] };
  }
  const exprOnly = /^(?:what(?:'s| is)|calc(?:ulate)?|=)?\s*([\d$.,()+\-*/^%\s]+)\??$/i.exec(t);
  if (exprOnly && /[+\-*/^]/.test(exprOnly[1]) && /\d/.test(exprOnly[1])) {
    try {
      return { text: `${exprOnly[1].trim()} = **${Math.round(evaluate(exprOnly[1]) * 1e8) / 1e8}**`, steps: [{ label: 'Calculated', ok: true }] };
    } catch {
      /* fall through to docs */
    }
  }

  const named = resolveTab(t);
  const here = SITE_TABS.find((x) => currentRoute().startsWith(x.route));
  const tab = named ?? here;

  if (SET.test(t) && tab) {
    const metas = PARAM_CATALOG[tab.id as TabId];
    const body = t.replace(/^.*?\b(?:set|change|make|switch|update|use|put|adjust)\b\s*/i, '').replace(/\b(on|in|for)\s+(the\s+)?(tab\s*\d|[\w/ ]+ tab)\b.*$/i, '');
    const pairs = parseAssignments(body, metas);
    if (Object.keys(pairs).length) {
      const r = await setParams(tab.id, pairs, 'user-command');
      const ok = Object.entries(r.applied).map(([k, v]) => `**${k}** → ${Array.isArray(v) ? (v.length ? v.join(', ') : 'all') : String(v === '' ? 'today' : v)}`);
      const bad = Object.entries(r.rejected).map(([k, why]) => `${k}: ${why}`);
      steps.push({ label: ok.length ? `${tab.label}: ${Object.keys(r.applied).join(', ')}` : `Couldn't change ${Object.keys(r.rejected).join(', ')}`, ok: ok.length > 0 });
      return { text: [ok.length ? `Done on **${tab.label}**: ${ok.join(', ')}. (Say "undo" to revert.)` : '', bad.length ? `I couldn't apply: ${bad.join(' ')}` : ''].filter(Boolean).join('\n\n'), steps };
    }
  }
  if (NAV.test(t) && named) {
    const r = (await executeClientTool('navigate', { tab: named.id })) as { ok: boolean };
    return { text: r.ok ? `Opened **${named.label}** — ${named.summary}` : `I tried to open ${named.label} but it is slow to load.`, steps: [{ label: `Opened ${named.label}`, ok: r.ok }] };
  }
  return searchDocs(t);
}
