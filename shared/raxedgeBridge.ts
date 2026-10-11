/**
 * RaxEdge bridge — everything we take from a user's own RaxEdge session, in ONE export, done in their own browser.
 *
 * RaxEdge's data routes (/api/real/otd, /api/fd/*, /api/dk/*, /api/real/{sync,live-probs,pack-odds}) answer only to a logged-in
 * RaxEdge session cookie and send no CORS permission, so no other site (or server of ours) can call them. The user runs the
 * snippet below while on raxedge.com (bookmarklet or console); it reads their own data with their own session, shows an
 * overlay with checkboxes and a Copy button, and the text is pasted into RAX, parsed in the browser and kept in localStorage.
 * Nothing is sent to us. (RaxEdge's owner, @moe_, has OK'd this use.)
 *
 * Sections (each independent and optional):
 *   otd       the user's passes + per-day earnings                   → Tabs 7, 8   (shared/raxedgeImport.ts)
 *   odds      FanDuel + DraftKings lines, Real's market probabilities → Tab 9
 *   packOdds  per player-season pack pull odds + average card value   → Tab 7 pricing, swaps
 * Every feature built on a section is an OPTION that is OFF by default; importing data changes nothing until it's enabled.
 *
 * Plan limits seen on a FREE RaxEdge account (2026-10-11): FD nhl/mlb/nbaalts/wnbaalts/ufc/rfi, DK nfl/nhl/mlb/cfb/wnba/props,
 * live-probs, sync for nba/nfl/mlb/wnba and pack-odds work; FD fc/wc and Real sync for nhl/ncaaf/ufc/fc say "Pro plan required".
 * Failed routes are recorded in `errors` instead of aborting the export.
 */
import { parseRaxEdgeExport, type RaxEdgeExport } from './raxedgeImport';

/** Raw route responses, kept as RaxEdge returns them; parsers live next to the consumers (shared/oddsRaxEdge.ts, shared/raxedgePackOdds.ts). */
export interface RaxEdgeOddsExport {
  /** FanDuel: key = route suffix ('nhl' | 'mlb' | 'nbaalts' | 'wnbaalts' | 'ufc' | 'fc' | 'wc'), value = JSON from /api/fd/<key>. */
  fd: Record<string, unknown>;
  /** DraftKings: key = route suffix ('nfl-lines' | 'nhl-lines' | 'mlb-lines' | 'cfb-lines' | 'wnba-lines' | 'nbaalts' | 'contender-series'). */
  dk: Record<string, unknown>;
  real: {
    /** /api/real/sync?sport=<realSport> keyed by Real sport slug (basketball_nba, football_nfl, baseball_mlb, basketball_wnba, hockey_nhl …). */
    sync: Record<string, unknown>;
    /** /api/real/live-probs response. */
    live: unknown;
  };
  /** route → error text, e.g. { 'fd/fc': 'Pro plan required' }. */
  errors: Record<string, string>;
}

/** [sport, season, id, name, position, avgCardValue, total, epic%, legendary%, rare%] — compact form of /api/real/pack-odds players. */
export type PackRow = [string, string, string, string, string, number, number, number, number, number];
export interface RaxEdgePackExport {
  /** ms since epoch when exported. */
  at: number;
  players: PackRow[];
}

export interface RaxEdgeBundle {
  v: 2;
  kind: 'rax-bridge';
  at: string;
  /** RaxEdge plan of the exporting account ('free' | 'pro'), for the "this needs Pro" hints. */
  plan?: string;
  otd?: RaxEdgeExport;
  odds?: RaxEdgeOddsExport;
  packOdds?: RaxEdgePackExport;
}

export interface ParsedBridge {
  bundle: RaxEdgeBundle | null;
  /** Human-readable problems (bad JSON, unknown format). */
  errors: string[];
}

/** Accepts the v2 bundle, or the older v1 OTD-only export (wrapped into a v2 bundle). */
export function parseBridge(text: string): ParsedBridge {
  let data: any;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return { bundle: null, errors: ['That does not look like a RAX export (invalid JSON). Run the RaxEdge export again and paste everything it copies.'] };
  }
  if (data?.v === 1 && Array.isArray(data.passes)) return { bundle: { v: 2, kind: 'rax-bridge', at: String(data.at ?? ''), otd: data as RaxEdgeExport }, errors: [] };
  if (data?.v === 2 && data.kind === 'rax-bridge') return { bundle: data as RaxEdgeBundle, errors: [] };
  return { bundle: null, errors: ['Unrecognised export format.'] };
}

/** Compact a /api/real/pack-odds response into PackRows (drops ids' extra fields and unusable rows). */
export function packRowsFrom(resp: unknown): PackRow[] {
  const players = (resp as { players?: any[] } | null)?.players;
  if (!Array.isArray(players)) return [];
  const out: PackRow[] = [];
  for (const p of players) {
    if (!p?.name || !(p.avgCardValue > 0)) continue;
    out.push([String(p.sport), String(p.season), String(p.id), String(p.name), String(p.position ?? ''), +p.avgCardValue, +(p.total ?? 0), +(p.odds?.epic ?? 0), +(p.odds?.legendary ?? 0), +(p.odds?.rare ?? 0)]);
  }
  return out;
}

export { parseRaxEdgeExport, type RaxEdgeExport };

/* ------------------------------ the snippet ------------------------------ */

/**
 * Runs on raxedge.com in the user's own logged-in session. Shows an overlay with three checkboxes, builds a v2 bundle from
 * the ticked sections, and offers Copy. Plain JS with semicolons and no line comments (it's also collapsed to a bookmarklet).
 * Only same-origin raxedge.com routes are called — a unit test enforces that.
 */
export const RAXEDGE_BRIDGE_SNIPPET = `(async()=>{try{
if(!/(^|\\.)raxedge\\.com$/.test(location.hostname)){alert('Open raxedge.com (logged in) and run this there.');return;}
const J=u=>fetch(u,{credentials:'same-origin'}).then(async r=>{const d=await r.json().catch(()=>null);if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));return d;});
const me=await J('/api/auth/me').catch(()=>({}));
const b=document.createElement('div');b.style.cssText='position:fixed;z-index:2147483647;inset:6% 8%;background:#0b0e14;color:#f9fafb;padding:16px;border:1px solid #3b82f6;border-radius:10px;font:14px system-ui;display:flex;flex-direction:column;gap:10px;overflow:auto';
b.innerHTML='<b>Export from RaxEdge to RAX</b><span style="opacity:.7">Runs in your browser with your login. Nothing is sent anywhere; you copy the result and paste it into RAX.</span><label><input type="checkbox" id="rxo" checked> My OTD passes &amp; earnings (Tabs 7-8) <input id="rxu" placeholder="Real username" style="margin-left:6px;padding:3px;background:#151b26;color:#fff;border:1px solid #232d3f"></label><label><input type="checkbox" id="rxd" checked> FanDuel / DraftKings lines &amp; Real market % (Tab 9)</label><label><input type="checkbox" id="rxp" checked> Pack odds - cost of rating per player (Tab 7)</label><div><button id="rxg" style="padding:6px 14px">Export</button> <button id="rxx" style="padding:6px 14px">Close</button></div><div id="rxs" style="opacity:.8"></div><textarea id="rxt" readonly style="flex:1;min-height:90px;background:#151b26;color:#9ca3af;border:1px solid #232d3f;display:none"></textarea><div><button id="rxc" style="padding:6px 14px;display:none">Copy to clipboard</button></div>';
document.body.appendChild(b);
const q=s=>b.querySelector(s);const st=m=>{q('#rxs').textContent=m;};
if(window.otdSelectedUser&&window.otdSelectedUser.username)q('#rxu').value=window.otdSelectedUser.username;
q('#rxx').onclick=()=>b.remove();
q('#rxg').onclick=async()=>{try{q('#rxg').disabled=true;const out={v:2,kind:'rax-bridge',at:new Date().toISOString(),plan:me.plan||'unknown'};
if(q('#rxo').checked){st('Loading your passes...');const name=q('#rxu').value.trim();if(name){let u=window.otdSelectedUser&&window.otdSelectedUser.id&&window.otdSelectedUser.username.toLowerCase()===name.toLowerCase()?window.otdSelectedUser:null;if(!u){const s=await J('/api/real/otd?action=search_users&q='+encodeURIComponent(name));const us=s.users||[];u=us.find(x=>x.username.toLowerCase()===name.toLowerCase())||us[0];}
if(u){const pa=await J('/api/real/otd?action=user_passes_all&userId='+encodeURIComponent(u.id));const eb=await J('/api/real/otd?action=earnings_bundle&userId='+encodeURIComponent(u.id)).catch(()=>({earnings:{}}));const E=eb.earnings||{};const seen={};const todo=[];
for(const p of pa.passes||[]){if(!(p.level>=1))continue;const t=p.entityType||'player';const k=p.playerId+'|'+p.sport+'|'+p.season+'|'+p.level+'|'+t;if(seen[k])continue;seen[k]=1;todo.push([k,p,t]);}
const enc=a=>(a||[]).map(e=>{const d=String(e.day||'');return d.length>=10&&e.earnings?(+d.slice(5,7)*100+ +d.slice(8,10))+':'+e.earnings:null;}).filter(Boolean).join(',');
const rows=[];const total=todo.length;const w=async()=>{while(todo.length){const [k,p,t]=todo.shift();let e=E[k]&&E[k].earnings;if(!e){try{const r=await J('/api/real/otd?action=earnings&id='+p.playerId+'&sport='+p.sport+'&season='+p.season+'&level='+p.level+'&entityType='+t);e=r.earnings;}catch(_){e=null;}}rows.push([p.sport,String(p.season),p.level,t,p.playerId,p.playerName||'',enc(e)]);if(rows.length%100===0)st('Passes '+rows.length+'/'+total);}};
await Promise.all([w(),w(),w(),w()]);out.otd={v:1,user:u.username,at:out.at,passes:rows};}else st('No Real user found for '+name);}else st('Add your Real username to export passes.');}
if(q('#rxd').checked){st('Loading odds...');const o={fd:{},dk:{},real:{sync:{},live:null},errors:{}};
for(const k of ['nhl','mlb','nbaalts','wnbaalts','ufc','fc','wc']){try{o.fd[k]=await J('/api/fd/'+k);}catch(e){o.errors['fd/'+k]=e.message;}}
for(const k of ['nfl-lines','nhl-lines','mlb-lines','cfb-lines','wnba-lines','nbaalts','contender-series']){try{o.dk[k]=await J('/api/dk/'+k);}catch(e){o.errors['dk/'+k]=e.message;}}
for(const k of ['basketball_nba','football_nfl','baseball_mlb','basketball_wnba','hockey_nhl','football_ncaaf','soccer_fc','mma_ufc']){try{o.real.sync[k]=await J('/api/real/sync?sport='+k);}catch(e){o.errors['real/sync/'+k]=e.message;}}
try{o.real.live=await J('/api/real/live-probs');}catch(e){o.errors['real/live-probs']=e.message;}out.odds=o;}
if(q('#rxp').checked){st('Loading pack odds...');try{const po=await J('/api/real/pack-odds');out.packOdds={at:Date.now(),players:(po.players||[]).filter(p=>p&&p.name&&p.avgCardValue>0).map(p=>[String(p.sport),String(p.season),String(p.id),String(p.name),String(p.position||''),+p.avgCardValue,+(p.total||0),+((p.odds||{}).epic||0),+((p.odds||{}).legendary||0),+((p.odds||{}).rare||0)])};}catch(e){st('Pack odds failed: '+e.message);}}
const text=JSON.stringify(out);const ta=q('#rxt');ta.value=text;ta.style.display='';const c=q('#rxc');c.style.display='';
c.onclick=async()=>{try{await navigator.clipboard.writeText(text);}catch(_){ta.select();document.execCommand('copy');}c.textContent='Copied';};
st('Ready: '+(out.otd?out.otd.passes.length+' passes, ':'')+(out.odds?'odds, ':'')+(out.packOdds?out.packOdds.players.length+' pack rows, ':'')+Math.round(text.length/1024)+' KB. Click Copy, then paste into RAX.');
q('#rxg').disabled=false;}catch(e){st('Export failed: '+e.message);q('#rxg').disabled=false;}};
}catch(e){alert('Export failed: '+e.message);}})();`;

export const raxedgeBridgeBookmarklet = (): string => 'javascript:' + encodeURIComponent(RAXEDGE_BRIDGE_SNIPPET.replace(/\n/g, ''));
