# RAX — RealApp Super-Suite

An unofficial analytics and scouting terminal for Real App cards, built for **Cloudflare Pages + Pages Functions** (free tier), intended for `rax.vivaanshahani.com`.

| Tab | What it is | Data |
|---|---|---|
| 1 · Rateboard | A window onto [Rateboard](https://rateboard-cgi.pages.dev): board, buyer/seller flows, copy-messages, profile inspector | **Live** — every action is a real request to Rateboard |
| 2 · Scout | Overpriced-auction radar, proactive scout (DM pitch generator), repeat contenders | Live feed if configured, else **sample** |
| 3 · Volatility | Spike screener, fair-value scatter, candles, **Monte Carlo projections** | Live history if configured, else **sample** |
| 4 · OTD Rax | 2-claim optimizer, ROI / break-even, comparison, catalog, dataset import | **Sample** until you import games |
| 5 · Portfolio | Earnings audit, CDN asset downloader | Public CDN (`media.realapp.com`) + inputs you provide |
| 6 · Quads | Pacing, poll analytics, payout reference, squad board | **Live** schedule (ESPN public scoreboards); **sample** polls |

Every panel that can show synthetic data carries a **SAMPLE DATA** badge. Nothing synthetic is presented as live.

## Develop

```bash
npm install
npm run dev          # Vite on :5173 (proxies /api → :8788)
npm run build        # typecheck (app + functions) and build to dist/
npm run pages:dev    # serve dist/ + Pages Functions locally on :8788 (run build first)
npm test             # unit tests (vitest)
```
Run `npm run build && npm run pages:dev` in one terminal and `npm run dev` in another for hot reload with real functions.

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
   Build command `npm run build`, output directory `dist`, Node 20+.
3. (Optional, for live market history) create a KV namespace and bind it as **`CACHE`**:
   `npx wrangler kv namespace create CACHE`, then Pages → Settings → Bindings → KV namespace → variable `CACHE`.
4. Pages → Custom domains → add `rax.vivaanshahani.com`.
5. Verify: open `/api/proxy/rateboard?path=api/kv&key=ratebrd_market_v1` — you should see `{"board":{…}}` with `x-credit: Rateboard…` and no `hash` fields.

### Configuration (Pages → Settings → Variables)

| Variable | Purpose |
|---|---|
| `CDN_ALLOWED_HOSTS` | CDN hostnames the downloader may fetch (set to `media.realapp.com` in `wrangler.toml`) |
| `REAL_API_BASE` | an **authorised** upstream for `/api/proxy/real` — Real's own API can't be called anonymously, see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) |
| `AUCTIONS_ENDPOINT` | path under `REAL_API_BASE` of an auctions feed; turns Tab 2/3 live |
| `REAL_USER_AGENT` | override the UA sent upstream (default: an honest `rax-super-suite/…`) |

Until these are set the corresponding features show a clear "not configured" state or fall back to labelled sample data.

## Architecture

```
src/            React + Tailwind UI (one lazy chunk per tab)
shared/         pure logic used by both browser and edge: formulas, Rateboard rules,
                OTD engine, quads, season calendar, Monte Carlo, deterministic sample data
functions/api/
  proxy/rateboard.ts   pass-through to rateboard-cgi.pages.dev (allowlisted, sanitised)
  proxy/real.ts        generic proxy for an *authorised* upstream (allowlisted, cached)
  proxy/cdn.ts         image proxy for downloads (host allowlist, https only, size cap)
  scout/auctions.ts    per-rating price + 7-day baselines + repeat contenders
  market/spikes.ts     spike screen, fair-value model, candles, forecast inputs
  intel/schedule.ts    live game schedule from ESPN public scoreboards (Tab 6)
```

**Caching.** Responses are cached with Cloudflare's Cache API (free, no write quota) — 15 s for the Rateboard board, 60 s for live games, 300 s for profiles. Workers **KV** is used only for the rolling market-history document (hourly points for 7 days, daily to 30), written at most every 10 minutes. This deviates from "cache everything in KV" on purpose: the free tier allows ~1,000 KV writes/day, which per-response caching would exhaust.

**Why the Monte Carlo runs in the browser.** Free-tier Functions get ~10 ms CPU per request; 4,000 simulated paths don't fit. The edge only assembles inputs (`?forecastInputs=`); the simulation runs client-side, seeded and reproducible.

## Tab 1 — the Rateboard wrapper

Rateboard's JSON API sends no CORS headers, so the browser can't call it directly. `/api/proxy/rateboard` makes the **same request server-side**: board read, player search, collection pull ("Pull my cards from Real", including Rateboard's chunking and load-spreading wait), sign-up/sign-in, and post/change/remove offer. Copy-messages (`i have <rating> <player> <rating × rate, to the nearest 10>`), floors, the house list, big orders and quicksells are ported 1:1 from Rateboard's own logic and unit-tested (`shared/rateboard.ts`).

Deliberately **not** proxied:
- whole-board overwrite (`POST /api/kv {key, value}`) — a data-loss footgun
- admin operations (delete others' offers, reset passwords, data reports)
- `/api/scan` (Rateboard's paid screenshot reader — "Read screenshots on Rateboard ↗" links out) and `/api/rax` (their access-gated game data)

Stripped before anything reaches the browser: every account's password hash, the private reports list, and the game-data grant list. Passwords are hashed **in the browser**; sign-in sends only the hash, compared server-side, never stored or logged.

Every listed card has a **Trade / List this Card on Rateboard ↗** button → `https://rateboard-cgi.pages.dev/?card={id}&action=trade`.

## Monte Carlo projections (Tab 3)

Seeded stochastic simulation — **no machine learning**. See `shared/montecarlo.ts` for the full model: fundamental level + decaying hype; seasonal drift (pre-season ramp → in-season → playoffs → post-season decay → off-season); mean reversion to an anchor shrunk toward similar cards; Student-t shocks and jumps; thin-market volatility inflation; per-path drift/vol uncertainty; observation noise that grows as volume falls; and a bounded, mean-reverting rating process (weekly in-season shocks, season-start refresh) correlated with price.

**Assumptions, not facts:** the seasonal drift sizes, hype half-life, jump frequency and rating volatility are priors, **not fitted to Real's market** — only ~30 days of price history exist, so "previous seasons" enter as priors. Re-fit them once multi-season data exists. A walk-forward test on the sample market checks the 5–95% band covers realised prices ≥ 85% of the time.

## Known limits (please read)

- **Real's own API can't be used anonymously.** It requires a login session, a signed per-request token and a Turnstile token (see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for the full findings and ways forward). The spec's spoofed-User-Agent approach would not work, and forging those tokens would be circumventing access controls, so it isn't done.
- **No live feed ⇒ sample data** for Tabs 2–4 and the poll percentages in 6 (clearly badged). Tab 4's real OTD database isn't bundled — import a CSV/JSON.
- Rateboard ignores the `?card=…&action=trade` parameters (it just opens the site), per its current source.
- Rateboard's server does not authenticate writes (it trusts the `user` field) and publishes password hashes on a public endpoint. This wrapper doesn't rely on or exploit either; it's worth telling its owner.
- Get Rateboard's blessing: this wrapper sends your users' traffic to their backend.
- Not affiliated with Real. Not financial advice.
