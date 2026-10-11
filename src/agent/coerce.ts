/** Turns whatever the model (or a human typing in the offline helper) supplies into a valid parameter value, or says why not. Pure. */
import type { AgentParamSpec } from '../../shared/agent/types';

export type Coerced = { ok: true; value: unknown } | { ok: false; reason: string };

const bad = (reason: string): Coerced => ({ ok: false, reason });

/** "50k" → 50000, "1.5m" → 1500000, "$2,500" → 2500, "75%" → 75. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*[$]?\s*(-?\d[\d,]*\.?\d*|-?\.\d+)\s*([kKmM]?)\s*%?\s*$/.exec(v);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : n;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./]+/g, '');

/** Case/spacing-insensitive enum match; a unique prefix also matches ("leg 3" is not a prefix, "iconic" is). */
export function matchEnum(v: string, values: string[]): string | null {
  const n = norm(v);
  if (!n) return null;
  const exact = values.find((x) => norm(x) === n);
  if (exact) return exact;
  const pref = values.filter((x) => norm(x).startsWith(n));
  return pref.length === 1 ? pref[0] : null;
}

export function coerceParam(spec: Pick<AgentParamSpec, 'type' | 'values' | 'min' | 'max' | 'name'>, raw: unknown): Coerced {
  switch (spec.type) {
    case 'number':
    case 'integer': {
      const n = parseNumber(raw);
      if (n === null) return bad(`"${spec.name}" needs a number (got ${JSON.stringify(raw)}).`);
      if (spec.type === 'integer' && !Number.isInteger(n)) return bad(`"${spec.name}" must be a whole number.`);
      if (spec.min !== undefined && n < spec.min) return bad(`"${spec.name}" must be at least ${spec.min}.`);
      if (spec.max !== undefined && n > spec.max) return bad(`"${spec.name}" must be at most ${spec.max}.`);
      return { ok: true, value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const s = String(raw).toLowerCase().trim();
      if (['true', 'yes', 'on', '1', 'enable', 'enabled'].includes(s)) return { ok: true, value: true };
      if (['false', 'no', 'off', '0', 'disable', 'disabled'].includes(s)) return { ok: true, value: false };
      return bad(`"${spec.name}" must be true or false.`);
    }
    case 'enum': {
      const hit = matchEnum(String(raw), spec.values ?? []);
      return hit !== null ? { ok: true, value: hit } : bad(`"${spec.name}" must be one of: ${(spec.values ?? []).join(', ')}.`);
    }
    case 'string': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return bad(`"${spec.name}" must be text.`);
      return { ok: true, value: String(raw).slice(0, 120) };
    }
    case 'date': {
      const s = String(raw).trim().toLowerCase();
      if (s === '' || s === 'today' || s === 'now') return { ok: true, value: '' };
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { ok: true, value: s } : bad(`"${spec.name}" must be a date like 2026-12-01 (or "today").`);
    }
    case 'string[]': {
      const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[,;/]|\band\b/i).map((x) => x.trim()).filter(Boolean) : null;
      if (!items) return bad(`"${spec.name}" must be a list.`);
      if (items.length === 1 && /^(all|any|every(thing)?|none)$/i.test(items[0])) return { ok: true, value: [] };
      if (!spec.values?.length) return { ok: true, value: items.slice(0, 20) };
      const out: string[] = [];
      for (const it of items) {
        const hit = matchEnum(it, spec.values);
        if (hit === null) return bad(`"${spec.name}": "${it}" is not one of ${spec.values.join(', ')}.`);
        if (!out.includes(hit)) out.push(hit);
      }
      return { ok: true, value: out };
    }
  }
}
