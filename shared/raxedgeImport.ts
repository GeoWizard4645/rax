/**
 * Import of a user's passes + per-day earnings from RaxEdge, done in the USER'S OWN BROWSER.
 *
 * RaxEdge's OTD endpoints (`/api/real/otd?action=user_passes_all|earnings_bundle|earnings`) answer only to a logged-in
 * RaxEdge session cookie, and their CORS policy doesn't allow another site to use it. So nothing here (or on our server)
 * ever sees a RaxEdge credential: the user runs a small snippet while on raxedge.com, which reads their own data with
 * their own session and puts a compact JSON export on their clipboard; they paste it into our "My cards" box. The data
 * stays in their browser (localStorage).
 *
 * Why it's worth it: RaxEdge knows each pass's EXACT level and per-day earnings, including team cards and UFC fighters
 * that Rateboard's per-game data doesn't cover.
 *
 * Level numbering (RaxEdge / Real "level"): 0 General, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5–9 Legendary 1–5,
 * 10–19 Mystic 1–10, 20+ Iconic 1+. Verified against RaxEdge's UI (e.g. Rare = 3, Uncommon = 2, Iconic 1 = 20).
 */
import { FIGHTER_CAPS, multiplierFor } from './otdRules';
import { mmddToLabel, seasonLabelFor, type OtdCardRecord, type OtdDay, type OtdSport } from './otdSnapshot';
import { norm } from './rateboard';

export const RE_SPORT: Record<string, OtdSport> = {
  mlb: 'MLB', nba: 'NBA', nhl: 'NHL', nfl: 'NFL', wnba: 'WNBA', golf: 'PGA', ufc: 'UFC', ncaaf: 'CFB', ncaam: 'CBB', ncaab: 'CBB', ncaabb: 'CBB', soccer: 'SOC',
};

/** RaxEdge's multiplier scales for non-player cards (from its client). Team cards are much flatter; UFC has its own table. */
const TEAM_BY_LEVEL = (l: number) => (l <= 0 ? 1 : l === 1 ? 1.2 : l === 2 ? 1.4 : l === 3 ? 1.6 : l === 4 ? 2 : l <= 9 ? 2.5 : l <= 19 ? 4 : 6);
const UFC_TABLE: Record<number, number> = {
  1: 1, 2: 1.4, 3: 1.6, 4: 2, 5: 5, 6: 5.4, 7: 5.8, 8: 6.2, 9: 6.7,
  10: 10, 11: 10.2, 12: 10.4, 13: 10.6, 14: 10.8, 15: 11, 16: 11.2, 17: 11.4, 18: 11.6, 19: 12,
  20: 20, 21: 20.3, 22: 20.6, 23: 20.9, 24: 21.2, 25: 21.5, 26: 21.8, 27: 22.1, 28: 22.4, 29: 22.7, 30: 23, 31: 23.3, 32: 23.6, 33: 23.9, 34: 24.2, 35: 24.5,
};
/** Team-card OTD caps by tier (shared/otdRules.ts TEAM_CAPS, from Real's team-cards page — may be stale). Iconic assumed uncapped. */
const TEAM_CAP = (l: number): number | null => (l <= 0 ? 800 : l === 1 ? 1_500 : l === 2 ? 2_500 : l === 3 ? 4_000 : l === 4 ? 6_000 : l <= 9 ? 12_000 : l <= 19 ? 24_000 : null);

/** Ladder key for a numeric level (players): 'Epic', 'Legendary 3', 'Mystic 10', 'Iconic', 'Iconic 4'. Null for General / unknown. */
export function levelKey(level: number): string | null {
  if (!(level >= 1)) return null;
  if (level <= 4) return ['Common', 'Uncommon', 'Rare', 'Epic'][level - 1];
  if (level <= 9) return `Legendary ${level - 4}`;
  if (level <= 19) return `Mystic ${level - 9}`;
  const n = level - 19;
  return n === 1 ? 'Iconic' : n <= 20 ? `Iconic ${n}` : null;
}

export interface ReLevel {
  /** Label shown in the UI. */
  label: string;
  /** Ladder key for player cards (drives the standard multiplier and cap); null for team / fighter cards. */
  rung: string | null;
  fixed?: { multiplier: number; annualCap: number | null; label: string };
}

export function reLevel(sport: OtdSport, type: 'player' | 'team', level: number): ReLevel | null {
  const key = levelKey(level);
  if (!key) return null;
  // UFC first: RaxEdge's feed marks UFC fighters as entityType "team", but they follow the UFC scale, not the team one.
  if (sport === 'UFC') {
    const m = UFC_TABLE[level];
    if (!m) return null;
    const capKey = level >= 20 ? null : key;
    return { label: `Fighter ${key}`, rung: null, fixed: { multiplier: m, annualCap: capKey ? FIGHTER_CAPS[capKey] ?? null : null, label: `Fighter ${key}` } };
  }
  if (type === 'team') return { label: `Team ${key}`, rung: null, fixed: { multiplier: TEAM_BY_LEVEL(level), annualCap: TEAM_CAP(level), label: `Team ${key}` } };
  return multiplierFor(key) == null ? null : { label: key, rung: key };
}

/* ------------------------------ export format ------------------------------ */

/** [sport, season, level, type, id, name, "mmdd:base,mmdd:base,…"] */
export type RePass = [string, string, number, string, number | string, string, string];
export interface RaxEdgeExport {
  v: 1;
  user: string;
  at: string;
  passes: RePass[];
}

export interface RaxEdgeImport {
  /** Cards to add to the user's data (passes the dataset lacks, plus all team / UFC cards). */
  cards: OtdCardRecord[];
  /** card id → level label for everything owned (ids of dataset cards where they matched). */
  owned: Record<string, string>;
  matchedToDataset: number;
  errors: string[];
  user: string;
}

function parseDays(s: string): OtdDay[] {
  const out: OtdDay[] = [];
  for (const part of String(s || '').split(',')) {
    const [d, v] = part.split(':');
    const mmdd = +d;
    const rax = +v;
    if (mmdd >= 101 && mmdd <= 1231 && rax > 0) out.push([mmdd, rax, 0]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Parse the pasted export. Player passes that already exist in `dataset` are linked to it (so they aren't offered again). */
export function parseRaxEdgeExport(text: string, dataset: OtdCardRecord[]): RaxEdgeImport {
  const errors: string[] = [];
  const empty: RaxEdgeImport = { cards: [], owned: {}, matchedToDataset: 0, errors, user: '' };
  let data: RaxEdgeExport;
  try {
    data = JSON.parse(text.trim());
  } catch {
    errors.push('That does not look like a RAX export (invalid JSON). Run the RaxEdge export again and paste everything it copies.');
    return empty;
  }
  if (!data || data.v !== 1 || !Array.isArray(data.passes)) {
    errors.push('Unrecognised export format.');
    return empty;
  }
  const byKey = new Map<string, OtdCardRecord>();
  for (const c of dataset) byKey.set(`${c.sport}|${c.season}|${norm(c.name)}`, c);

  const cards = new Map<string, OtdCardRecord>();
  const owned: Record<string, string> = {};
  let matched = 0;
  let skipped = 0;
  for (const p of data.passes) {
    const [sportKey, seasonTxt, level, typeTxt, id, name, ev] = p;
    const sport = RE_SPORT[String(sportKey).toLowerCase()];
    const type: 'player' | 'team' = typeTxt === 'team' ? 'team' : 'player';
    const season = +seasonTxt;
    const lv = sport && season ? reLevel(sport, type, +level) : null;
    if (!sport || !season || !lv) { skipped++; continue; }

    if (type === 'player' && sport !== 'UFC') {
      const hit = byKey.get(`${sport}|${season}|${norm(name)}`);
      if (hit) {
        // keep the best level if the same player-season appears twice
        const cur = owned[hit.id];
        if (!cur || (multiplierFor(lv.rung!) ?? 0) > (multiplierFor(cur) ?? 0)) owned[hit.id] = lv.rung!;
        matched++;
        // RaxEdge's list has every game; the dataset drops games under 3 rax. Keep the dataset id (so the card isn't offered
        // again) but carry the complete schedule — it replaces the dataset's copy.
        const full = parseDays(ev);
        if (full.length) {
          const total = full.reduce((n, d) => n + d[1], 0);
          cards.set(hit.id, { ...hit, days: full, games: full.length, annual: Math.max(hit.annual, total), best: Math.max(hit.best, ...full.map((d) => d[1])) });
        }
        continue;
      }
    }
    const days = parseDays(ev);
    if (!days.length) { skipped++; continue; }
    const cid = `re|${sport}|${season}|${type}|${id}`;
    const prev = cards.get(cid);
    if (prev && (prev.fixed?.multiplier ?? multiplierFor(owned[cid]) ?? 0) >= (lv.fixed?.multiplier ?? multiplierFor(lv.rung!) ?? 0)) continue;
    cards.set(cid, {
      id: cid,
      sport,
      season,
      seasonLabel: seasonLabelFor(sport, season),
      playerId: String(id),
      name: name || `${sport} ${id}`,
      team: '',
      owners: null,
      games: days.length,
      annual: days.reduce((n, d) => n + d[1], 0),
      best: Math.max(...days.map((d) => d[1])),
      days,
      kind: sport === 'UFC' ? 'fighter' : type === 'team' ? 'team' : 'player',
      ...(lv.fixed ? { fixed: lv.fixed } : {}),
    });
    owned[cid] = lv.fixed ? lv.fixed.label : lv.rung!;
  }
  if (skipped) errors.push(`${skipped} pass(es) skipped (General level, unknown sport/level, or no earnings data).`);
  return { cards: [...cards.values()], owned, matchedToDataset: matched, errors, user: String(data.user ?? '') };
}

/* ------------------------------ the snippet ------------------------------ */

/**
 * Runs on raxedge.com in the user's own logged-in session: reads their passes and earnings, shows an overlay with a Copy
 * button. Plain JS, semicolon-terminated, no line comments (it is also collapsed to a one-line bookmarklet).
 */
export const RAXEDGE_EXPORT_SNIPPET = `(async()=>{try{
if(!/(^|\\.)raxedge\\.com$/.test(location.hostname)){alert('Open raxedge.com (logged in, On This Day tab) and run this there.');return;}
const J=u=>fetch(u,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
let u=window.otdSelectedUser&&window.otdSelectedUser.id?window.otdSelectedUser:null;
if(!u){const q=(prompt('Real username to export (your own):')||'').trim();if(!q)return;const s=await J('/api/real/otd?action=search_users&q='+encodeURIComponent(q));const us=s.users||[];u=us.find(x=>x.username.toLowerCase()===q.toLowerCase())||us[0];if(!u){alert('No Real user found for '+q);return;}}
const pa=await J('/api/real/otd?action=user_passes_all&userId='+encodeURIComponent(u.id));
const eb=await J('/api/real/otd?action=earnings_bundle&userId='+encodeURIComponent(u.id)).catch(()=>({earnings:{}}));
const E=eb.earnings||{};const seen={};const todo=[];
for(const p of pa.passes||[]){if(!(p.level>=1))continue;const t=p.entityType||'player';const k=p.playerId+'|'+p.sport+'|'+p.season+'|'+p.level+'|'+t;if(seen[k])continue;seen[k]=1;todo.push([k,p,t]);}
const enc=a=>(a||[]).map(e=>{const d=String(e.day||'');return d.length>=10&&e.earnings?(+d.slice(5,7)*100+ +d.slice(8,10))+':'+e.earnings:null;}).filter(Boolean).join(',');
const out=[];const w=async()=>{while(todo.length){const [k,p,t]=todo.shift();let e=E[k]&&E[k].earnings;if(!e){try{const r=await J('/api/real/otd?action=earnings&id='+p.playerId+'&sport='+p.sport+'&season='+p.season+'&level='+p.level+'&entityType='+t);e=r.earnings;}catch(_){e=null;}}out.push([p.sport,String(p.season),p.level,t,p.playerId,p.playerName||'',enc(e)]);}};
await Promise.all([w(),w(),w(),w()]);
const text=JSON.stringify({v:1,user:u.username,at:new Date().toISOString(),passes:out});
const b=document.createElement('div');b.style.cssText='position:fixed;z-index:2147483647;inset:8% 10%;background:#0b0e14;color:#fff;padding:16px;border:1px solid #3b82f6;border-radius:10px;font:14px system-ui;display:flex;flex-direction:column;gap:10px';
b.innerHTML='<b>RAX export ready — '+out.length+' passes for '+u.username+'</b><span style="opacity:.7">Click Copy, then paste into RAX → OTD Efficiency → My cards → Import from RaxEdge. Nothing was sent anywhere.</span><textarea readonly style="flex:1;background:#151b26;color:#9ca3af;border:1px solid #232d3f"></textarea><div><button id="rxc" style="padding:6px 14px">Copy to clipboard</button> <button id="rxx" style="padding:6px 14px">Close</button></div>';
document.body.appendChild(b);const ta=b.querySelector('textarea');ta.value=text;
b.querySelector('#rxc').onclick=async()=>{try{await navigator.clipboard.writeText(text);}catch(_){ta.select();document.execCommand('copy');}b.querySelector('#rxc').textContent='Copied ✓';};
b.querySelector('#rxx').onclick=()=>b.remove();
}catch(e){alert('Export failed: '+e.message);}})();`;

/** The snippet as a one-line `javascript:` bookmarklet URL. */
export const raxedgeBookmarklet = (): string => 'javascript:' + encodeURIComponent(RAXEDGE_EXPORT_SNIPPET.replace(/\n/g, ''));

export const reDayLabel = mmddToLabel;
