/**
 * Real marketplace capture — real auction and sales data from the user's OWN logged-in Real web session, recorded passively.
 *
 * Real's API is login + signed-token + Turnstile gated, so no server (or other site) can read it, and we don't try. But the
 * Real web app already SHOWS a user: every live auction (player, play, rarity, rating, serial, time left, current bid, bid
 * count) on the Marketplace, and for any card a "Market data" view (median price, price per rating, total sales, premium,
 * min–max, quartiles, 30-day history) with a list of individual recent sales (price, price per rating, timestamp).
 *
 * The snippet below is run by the user on realapp.com (console or bookmarklet). It adds a small panel and READS THE PAGE'S
 * TEXT as the user browses — it makes no requests of its own, clicks nothing, and never touches headers, cookies or tokens.
 * "Export" copies compact JSON that the user pastes into Tab 2 / Tab 3. Nothing is sent anywhere. (Real's terms discourage
 * bulk data mining; this only records what you personally open and look at, at human speed.)
 */
export interface RealAuctionRow {
  sport: string;
  season: string | null;
  rarity: string;
  /** Card type shown on the card: RUSH, PASS, CATCH, PERFORMANCE, TOUCHDOWN, FIELD GOAL, DEFENSE/ST … */
  type: string;
  /** The card's rating (the number next to the Real icon). */
  rating: number;
  /** Play description ("4-YD RUSH") for play cards; null for performance cards. */
  play: string | null;
  player: string;
  team: string | null;
  serial: string;
  /** Current bid in Rax. */
  bid: number;
  bids: number;
  watchers: number;
  timeLeftSec: number | null;
  seenAt: string;
}

export interface RealSale {
  player: string;
  rating: number;
  rarity: string;
  serial: string;
  price: number;
  perRating: number | null;
  /** ISO timestamp (the exporter's local time zone applied). */
  at: string | null;
  /** The activity filter that was selected when it was recorded: 'Sold' | 'Accepted' | 'Open' | 'No Sale'. */
  outcome: string | null;
}

export interface RealMarketStat {
  /** Card the Market-data view was opened for. */
  name: string;
  rating: number;
  rarity: string;
  serial: string;
  /** 'Card' | 'Player' | 'Similar' — which comparison set the stats describe. */
  scope: string | null;
  /** e.g. '30d'. */
  window: string | null;
  median: number | null;
  medianPerRating: number | null;
  totalSales: number | null;
  premium: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  seenAt: string;
}

export interface RealMarketCapture {
  v: 1;
  kind: 'real-market';
  at: string;
  auctions: RealAuctionRow[];
  stats: RealMarketStat[];
  sales: RealSale[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Validate a pasted capture; drops malformed rows and says how many. */
export function parseRealCapture(text: string): { capture: RealMarketCapture | null; dropped: number; errors: string[] } {
  let d: any;
  try {
    d = JSON.parse(text.trim());
  } catch {
    return { capture: null, dropped: 0, errors: ['That is not a Real market capture (invalid JSON). Run the recorder on realapp.com and paste everything Export copies.'] };
  }
  if (!d || d.v !== 1 || d.kind !== 'real-market') return { capture: null, dropped: 0, errors: ['Unrecognised format — expected a "real-market" capture.'] };
  let dropped = 0;
  const auctions = (Array.isArray(d.auctions) ? d.auctions : []).filter((a: any) => {
    const ok = a && typeof a.player === 'string' && isNum(a.bid) && isNum(a.rating) && a.rating > 0 && typeof a.serial === 'string' && typeof a.rarity === 'string';
    if (!ok) dropped++;
    return ok;
  });
  const stats = (Array.isArray(d.stats) ? d.stats : []).filter((s: any) => {
    const ok = s && typeof s.name === 'string' && isNum(s.rating) && (isNum(s.median) || isNum(s.totalSales));
    if (!ok) dropped++;
    return ok;
  });
  const sales = (Array.isArray(d.sales) ? d.sales : []).filter((s: any) => {
    const ok = s && typeof s.player === 'string' && isNum(s.price) && isNum(s.rating) && s.rating > 0 && typeof s.serial === 'string';
    if (!ok) dropped++;
    return ok;
  });
  return { capture: { v: 1, kind: 'real-market', at: String(d.at ?? ''), auctions, stats, sales }, dropped, errors: [] };
}

/** "4h" / "5d" / "30m" / "45s" → seconds. */
export function timeLeftSeconds(t: string): number | null {
  const m = /^(\d+)\s*([smhd])$/i.exec(t.trim());
  if (!m) return null;
  return +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
}

/** Stable key of one sale (a given serial sells at most once per timestamp). */
export const saleKey = (s: Pick<RealSale, 'serial' | 'at' | 'price' | 'player'>) => `${s.player}|${s.serial}|${s.at}|${s.price}`;

/* ------------------------------ the recorder ------------------------------ */

/**
 * Runs on realapp.com. Plain JS, semicolons, no line comments (also collapsed to a bookmarklet). It only READS the page;
 * a unit test asserts it contains no fetch / XHR / WebSocket / beacon / click() calls.
 */
export const REAL_MARKET_SNIPPET = `(()=>{try{
if(!/(^|\\.)realapp\\.com$/.test(location.hostname)){alert('Open realapp.com (signed in), go to the Marketplace, then run this.');return;}
if(window.__raxRec){window.__raxRec.show();return;}
const RAR=/^(COMMON|UNCOMMON|RARE|EPIC|LEGENDARY|MYSTIC|ICONIC)$/i;
const num=s=>{const m=String(s==null?'':s).replace(/,/g,'').match(/-?\\d+(\\.\\d+)?/);return m?+m[0]:null;};
const lines=el=>(el.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean);
const leaf=(labels)=>[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&labels.includes(e.textContent.trim())&&e.offsetParent!==null);
const greenOf=labels=>{const g=leaf(labels).filter(e=>{const c=(getComputedStyle(e).color.match(/\\d+/g)||[]).map(Number);return c[1]>c[0]+50&&c[1]>c[2]+20;});return g.length?g[0].textContent.trim():null;};
const tleft=t=>{const m=/^(\\d+)\\s*([smhd])$/i.exec(t||'');return m?+m[1]*{s:1,m:60,h:3600,d:86400}[m[2].toLowerCase()]:null;};
const toIso=t=>{const m=/^([A-Z][a-z]{2}) (\\d{1,2}), (\\d{4}) at (\\d{1,2}):(\\d{2}) (AM|PM)$/.exec(t||'');if(!m)return null;const mo='JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1])/3;let h=+m[4]%12+(m[6]==='PM'?12:0);const d=new Date(+m[3],mo,+m[2],h,+m[5]);return isNaN(d)?null:d.toISOString();};
const A=new Map(),S=new Map(),SA=new Map();
const SPORTS=['NFL','MLB','NBA','WNBA','CFB','NHL','TEN','UFC','FC','Golf','CBB','CWS'];
const scanAuctions=()=>{const sport=greenOf(SPORTS)||'ALL';const season=([...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d{4}(-\\d{2})?$/.test(e.textContent.trim())&&e.offsetParent!==null).map(e=>e.textContent.trim())[0]||null);
for(const b of leaf(['Bid'])){let c=b,hit=null;for(let i=0;i<9&&c;i++){c=c.parentElement;if(c&&/#\\d+/.test(c.innerText||'')&&(c.innerText||'').length<700){hit=c;break;}}if(!hit)continue;const L=lines(hit);const ri=L.findIndex(l=>RAR.test(l));const bi=L.lastIndexOf('Bid');const si=L.findIndex(l=>/^#\\d+$/.test(l));if(ri<0||bi<1||si<0)continue;
const type=L[ri+1],rating=num(L[ri+2]);const perf=/^PERFORMANCE$/i.test(type);const play=perf?null:L[ri+3];const player=perf?L[ri+3]:L[ri+4];const ts=L.find(l=>/^[A-Z]{2,4} \\d{4}(-\\d{2})?$/.test(l));const tl=L.find(l=>/^\\d+[smhd]$/i.test(l));const bid=num(L[bi-1]);if(!player||!(rating>0)||!(bid>=0))continue;
const row={sport,season,rarity:L[ri],type,rating,play,player,team:ts?ts.split(' ')[0]:null,serial:L[si],bid,bids:num(L[1])||0,watchers:num(L[0])||0,timeLeftSec:tleft(tl),seenAt:new Date().toISOString()};A.set(sport+'|'+row.serial+'|'+player+'|'+type+'|'+rating,row);}};
const scanModal=()=>{const m=[...document.querySelectorAll('div')].filter(e=>/Market Data/.test(e.innerText||'')&&/Done/.test(e.innerText||'')&&(e.innerText||'').length>200&&(e.innerText||'').length<9000).sort((a,b)=>a.innerText.length-b.innerText.length)[0];if(!m)return;const L=lines(m);const di=L.indexOf('Done');if(di<0)return;const at=t=>{const i=L.indexOf(t);return i<0?null:i;};
const g=(label,off)=>{const i=at(label);return i==null?null:L[i+off];};const mi=at('Median');const mm=at('Min – Max');const qq=at('25th – 75th');
const st={name:L[di+1],rating:num(L[di+2]),rarity:L[di+3],serial:L[di+4],scope:greenOf(['Card','Player','Similar']),window:L.find(l=>/^\\d+d$/.test(l))||null,median:mi==null?null:num(L[mi+1]),medianPerRating:mi==null?null:num(L[mi+2]),totalSales:num(g('Total Sales',1)),premium:num(g('Premium',1)),min:mm==null?null:num(L[mm+1]),max:mm==null?null:num(L[mm+3]),q1:qq==null?null:num(L[qq+1]),q3:qq==null?null:num(L[qq+3]),seenAt:new Date().toISOString()};
if(st.name&&st.rating>0)SA.set(st.name+'|'+st.serial+'|'+st.scope+'|'+st.window,st);
const filter=greenOf(['Sold','Accepted','Open','No Sale']);const ra=at('Recent activity');if(ra==null)return;
for(let i=ra+1;i<L.length;i++){if(RAR.test(L[i])&&/^#\\d+$/.test(L[i+1]||'')){const when=L.slice(i+2,i+8).find(x=>/ at /.test(x))||null;const s={player:L[i-2],rating:num(L[i-1]),rarity:L[i],serial:L[i+1],price:num(L[i+2]),perRating:num(L[i+3]),at:toIso(when),outcome:filter};if(s.price>=0&&s.rating>0)S.set([s.player,s.serial,s.at,s.price,filter].join('|'),s);}}};
const box=document.createElement('div');box.style.cssText='position:fixed;z-index:2147483647;left:12px;bottom:12px;background:#0b0e14;color:#f9fafb;border:1px solid #3b82f6;border-radius:10px;padding:10px 12px;font:13px system-ui;max-width:300px';
box.innerHTML='<b>RAX recorder</b> <span style="opacity:.6">(read-only)</span><div id="rxs" style="margin:6px 0;opacity:.85"></div><div style="opacity:.6;margin-bottom:6px">Browse the Marketplace; open Market data on cards you care about. Nothing is sent anywhere.</div><button id="rxe" style="padding:4px 10px">Export</button> <button id="rxk" style="padding:4px 10px">Clear</button> <button id="rxh" style="padding:4px 10px">Hide</button><textarea id="rxt" readonly style="display:none;width:100%;height:80px;margin-top:6px;background:#151b26;color:#9ca3af;border:1px solid #232d3f"></textarea>';
document.body.appendChild(box);const q=s=>box.querySelector(s);
const upd=()=>{q('#rxs').textContent=A.size+' auctions - '+SA.size+' market views - '+S.size+' sales';};
const tick=()=>{try{scanAuctions();scanModal();upd();}catch(e){}};
const build=()=>({v:1,kind:'real-market',at:new Date().toISOString(),auctions:[...A.values()],stats:[...SA.values()],sales:[...S.values()]});
const iv=setInterval(tick,1200);tick();
q('#rxe').onclick=async()=>{const t=JSON.stringify(build());const ta=q('#rxt');ta.value=t;ta.style.display='';ta.select();try{await navigator.clipboard.writeText(t);q('#rxe').textContent='Copied';}catch(_){document.execCommand('copy');q('#rxe').textContent='Copied';}};
q('#rxk').onclick=()=>{A.clear();S.clear();SA.clear();upd();};
q('#rxh').onclick=()=>{box.style.display='none';};
window.__raxRec={build,show:()=>{box.style.display='';},stop:()=>{clearInterval(iv);box.remove();delete window.__raxRec;}};
}catch(e){alert('Recorder failed: '+e.message);}})();`;

export const realMarketBookmarklet = (): string => 'javascript:' + encodeURIComponent(REAL_MARKET_SNIPPET.replace(/\n/g, ''));
