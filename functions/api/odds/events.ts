/**
 * Betting-market odds for Tab 9 (Edge / EV)  —  GET /api/odds/events?sport=NBA|NHL|MLB|WNBA|NFL|CFB|CBB|FC|UFC|ALL
 *
 * Fans out to three FREE public sources in parallel (Kalshi market data, Polymarket Gamma, DraftKings lines embedded in ESPN's
 * scoreboard), normalises them to OddsMarket, matches the same game across sources, and returns OddsResponse. A failing
 * source is reported in `sources[]` and never fails the call. FanDuel and other sportsbooks are deliberately not used.
 *
 * Free-tier budget: ≤ 44 upstream subrequests per invocation (Cloudflare allows 50) — see planFanout() and docs/ODDS-SOURCES.md.
 */
import type { OddsResponse, OddsSource, OddsSourceStatus, OddsSport } from '../../../shared/odds';
import { ODDS_SPORTS } from '../../../shared/odds';
import {
  matchEvents,
  parseEspnOdds,
  parseKalshi,
  parsePolymarket,
  planFanout,
  type FanoutJob,
  type KalshiPayload,
  type PolyPayload,
  type RawEvent,
} from '../../../shared/oddsSources';
import { cached, err, json, OUR_UA, preflight, type Env } from '../../_lib/http';

const TTL = 45;

/**
 * Kalshi answers Cloudflare's shared egress IPs with HTTP 429, so when every live Kalshi call fails we fall back to a
 * snapshot taken by a GitHub Actions job (.github/workflows/odds-snapshot.yml → orphan branch `odds-data`). It is at most
 * ~10–15 min old and is reported as such in `sources[]`. Single-sport requests only (ALL would need many more subrequests).
 */
const SNAPSHOT_URL = (sport: string) => `https://raw.githubusercontent.com/GeoWizard4645/rax/odds-data/kalshi/${sport}.json`;
const SNAPSHOT_MAX_AGE_MS = 45 * 60_000;

interface KalshiSnapshot {
  generatedAt: string;
  payloads: Array<{ id: string; spec: KalshiPayload['spec']; json: unknown }>;
}

async function loadKalshiSnapshot(sport: OddsSport, wanted: Set<string>, nowMs: number): Promise<{ payloads: KalshiPayload[]; ageMin: number } | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await fetch(SNAPSHOT_URL(sport), { headers: { Accept: 'application/json' }, signal: ctl.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) return null;
    const snap = (await r.json()) as KalshiSnapshot;
    const age = nowMs - Date.parse(snap.generatedAt);
    if (!(age >= -60_000 && age <= SNAPSHOT_MAX_AGE_MS)) return null;
    const payloads = snap.payloads.filter((p) => wanted.has(p.id)).map((p) => ({ spec: p.spec, json: p.json }));
    return payloads.length ? { payloads, ageMin: Math.max(0, Math.round(age / 60_000)) } : null;
  } catch {
    return null;
  }
}
const TIMEOUT_MS = 6000;

/** Kalshi answers a burst of ~20 parallel calls with HTTP 429, so its calls are paced; the other sources run fully parallel. */
const KALSHI_CONCURRENCY = 3;
const KALSHI_PAUSE_MS = 220; // ≈ 8 req/s overall; Kalshi starts returning 429 above ~10/s from one IP
const RETRY_BUDGET = { left: 0 };

async function getJson(job: FanoutJob, retry = true): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // ESPN's CDN 403s unfamiliar User-Agents on some hosts (see functions/api/intel/schedule.ts) → no custom UA there.
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (job.source !== 'espn-dk') headers['User-Agent'] = OUR_UA;
    const r = await fetch(job.url, { headers, signal: ctl.signal });
    if (r.status === 429 && retry && RETRY_BUDGET.left > 0) {
      RETRY_BUDGET.left--;
      await new Promise((res) => setTimeout(res, 700));
      return await getJson(job, false);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/abort/i.test(msg) ? `timeout after ${TIMEOUT_MS} ms` : msg);
  } finally {
    clearTimeout(timer);
  }
}

async function runJobs(jobs: FanoutJob[]): Promise<PromiseSettledResult<unknown>[]> {
  const out: PromiseSettledResult<unknown>[] = new Array(jobs.length);
  const one = async (i: number) => {
    try {
      out[i] = { status: 'fulfilled', value: await getJson(jobs[i]) };
    } catch (reason) {
      out[i] = { status: 'rejected', reason };
    }
  };
  const kalshi: number[] = [];
  const rest: Promise<void>[] = [];
  jobs.forEach((j, i) => (j.source === 'kalshi' ? kalshi.push(i) : rest.push(one(i))));
  let next = 0;
  const worker = async () => {
    while (next < kalshi.length) {
      await one(kalshi[next++]);
      if (next < kalshi.length) await new Promise((res) => setTimeout(res, KALSHI_PAUSE_MS));
    }
  };
  await Promise.all([...rest, ...Array.from({ length: Math.min(KALSHI_CONCURRENCY, kalshi.length) }, worker)]);
  return out;
}

export const onRequest: PagesFunction<Env> = async ({ request, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');
  const q = (new URL(request.url).searchParams.get('sport') || 'ALL').toUpperCase();
  if (q !== 'ALL' && !ODDS_SPORTS.includes(q as OddsSport)) return err(400, 'bad_sport', `sport must be one of ${ODDS_SPORTS.join(', ')}, ALL.`);
  const sport = q as OddsSport | 'ALL';
  // ?markets=ml → moneyline only from Kalshi/Polymarket (skips their bulky spread/total feeds; lightest call). ALL is always lite.
  const lite = new URL(request.url).searchParams.get('markets') === 'ml';

  return cached(`odds/events/${sport}${lite ? '/ml' : ''}`, TTL, async () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const { jobs, trimmed } = planFanout(sport, nowMs, undefined, lite);
    RETRY_BUDGET.left = Math.max(0, 50 - jobs.length - 1); // stay ≤ 50 subrequests even with 429 retries
    const settled = await runJobs(jobs);

    const status = new Map<OddsSource, { ok: number; fail: number; err?: string }>();
    for (const s of ['kalshi', 'polymarket', 'espn-dk'] as OddsSource[]) status.set(s, { ok: 0, fail: 0 });
    const kalshi: KalshiPayload[] = [];
    const poly = new Map<string, PolyPayload>();
    const espn: Array<{ job: Extract<FanoutJob, { source: 'espn-dk' }>; data: unknown }> = [];
    settled.forEach((r, i) => {
      const job = jobs[i];
      const st = status.get(job.source)!;
      if (r.status === 'rejected') {
        st.fail++;
        st.err ??= `${job.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
        return;
      }
      st.ok++;
      if (job.source === 'kalshi') kalshi.push({ spec: job.spec, json: r.value });
      else if (job.source === 'polymarket') {
        const p = poly.get(job.spec.league) ?? { spec: job.spec };
        if (job.kind === 'moneyline') p.moneyline = r.value;
        else p.props = r.value;
        poly.set(job.spec.league, p);
      } else espn.push({ job, data: r.value });
    });

    // Live Kalshi is blocked from the edge (HTTP 429): use the GitHub-Actions snapshot instead (single-sport requests only).
    let kalshiNote: string | undefined;
    const kj = jobs.filter((j) => j.source === 'kalshi');
    if (sport !== 'ALL' && kj.length && status.get('kalshi')!.ok === 0) {
      const snap = await loadKalshiSnapshot(sport, new Set(kj.map((j) => j.id)), nowMs);
      if (snap) {
        kalshi.push(...snap.payloads);
        const st = status.get('kalshi')!;
        kalshiNote = `live Kalshi is rate-limiting our servers (${st.err ?? 'HTTP 429'}); using a ${snap.ageMin}-minute-old snapshot`;
        st.ok = snap.payloads.length;
        st.fail = 0;
        st.err = undefined;
      }
    }

    const safe = <T,>(source: OddsSource, f: () => T, fallback: T): T => {
      try {
        return f();
      } catch (e) {
        const st = status.get(source)!;
        st.ok = 0;
        st.fail++;
        st.err ??= `parse error: ${e instanceof Error ? e.message : String(e)}`;
        return fallback;
      }
    };
    const kRaw: RawEvent[] = safe('kalshi', () => parseKalshi(kalshi), []);
    const pRaw: RawEvent[] = safe('polymarket', () => parsePolymarket([...poly.values()]), []);
    const eRaw: RawEvent[] = safe('espn-dk', () => espn.flatMap((x) => parseEspnOdds(x.job.spec, x.data, nowIso)), []);

    // ESPN returns the same game on overlapping scoreboards only if dates overlap; de-dupe identical records.
    const seen = new Set<string>();
    const eUniq = eRaw.filter((e) => {
      const k = `${e.league}|${e.startsAt}|${e.home}|${e.away}`;
      return !seen.has(k) && !!seen.add(k);
    });

    const windowDays = sport === 'ALL' ? 2 : 3;
    const events = matchEvents([eUniq, pRaw, kRaw], nowMs).filter((e) => Date.parse(e.startsAt) <= nowMs + windowDays * 86_400_000 + 6 * 3600_000);

    const count = (src: OddsSource) => events.reduce((n, e) => n + e.markets.filter((m) => m.source === src).length, 0);
    const sources: OddsSourceStatus[] = (['kalshi', 'polymarket', 'espn-dk'] as OddsSource[]).map((source) => {
      const st = status.get(source)!;
      const planned = jobs.some((j) => j.source === source);
      const total = st.ok + st.fail;
      const out: OddsSourceStatus = { source, ok: planned ? st.ok > 0 : true, count: count(source) };
      if (!planned) out.error = 'no requests planned for this sport/budget';
      else if (source === 'kalshi' && kalshiNote) out.error = kalshiNote;
      else if (st.fail) out.error = `${st.fail} of ${total} requests failed (${st.err})`;
      return out;
    });

    const body: OddsResponse = { generatedAt: nowIso, sport, events, sources, meta: { subrequests: jobs.length, trimmed, windowDays, ...(lite || sport === 'ALL' ? { lite: true } : {}) } };
    return json(body, 200, { 'X-Data-Source': 'kalshi,polymarket,espn(draftkings)' });
  }, (p) => waitUntil(p));
};
