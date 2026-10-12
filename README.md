# RAX — RealApp Super-Suite

An unofficial analytics and scouting terminal for Real App cards, built for **Cloudflare Pages + Pages Functions** (free tier), intended for `rax.vivaanshahani.com`.

| Tab | What it is | Data |
|---|---|---|
| 1 · Rateboard | A window onto [Rateboard](https://rateboard-cgi.pages.dev): board, buyer/seller flows, copy-messages, profile inspector | **Live** — every action is a real request to Rateboard |
| 2 · Scout | Bids-above-market radar, proactive scout (match your collection to buyers), repeat bidders | **Live** Rateboard standing buy offers (bid RATES, Rax per rating point — not sale prices; rating/rarity unknown). Data-source switch: your own **captured Real data** / **Community** (opt-in, anonymous captures shared by RAX users — [docs/COMMUNITY-MARKET.md](docs/COMMUNITY-MARKET.md)) / Live / **imported snapshot** ([guide](docs/CAPTURE-GUIDE.md)) / **sample** |
| 3 · Volatility | Demand-spike screener, bid-rate vs depth scatter, candles, **Monte Carlo projections** of a player's bid rate; optional pack-cost-vs-bids panel | **Live** Rateboard bid rates **recorded over time** (history grows; spikes/candles/forecast unlock after 3 days). Switch: your captured Real data / **Community** (shared by RAX users, verified-only by default) / Live / imported snapshot / **sample** — see [docs/MARKET-DATA-SOURCES.md](docs/MARKET-DATA-SOURCES.md) |
| 5 · Portfolio | Earnings audit, CDN asset downloader | Public CDN (`media.realapp.com`) + inputs you provide |
| 6 · Quads | Pacing, poll analytics, payout reference, squad board | **Live** schedule (ESPN public scoreboards); **sample** polls |
| 4 · *(retired)* | The old OTD Rax tab was replaced by Tab 7; `/otd` redirects there. | — |
| 7 · OTD Efficiency | Which cards (and which rarity) earn the most OTD Rax per Rax spent, over a chosen timeframe; overlap-aware best combination; sport outlook; upgrade ladder; swap calculator | **Observed** snapshot of Real's per-game Rax (via Rateboard) or **Modeled** from ESPN stats — switchable; prices are estimates |
| 9 · Edge / EV | No-vig fair probabilities for every upcoming game from Kalshi, Polymarket and DraftKings-via-ESPN (per source + consensus, moneyline / spread / total); type Real's displayed % to get EV, edge, fractional-Kelly stake, a sensitivity table and a Best-EV board; editable Real rake assumptions; beginner guide | **Live** free public odds, refreshed every 60 s; Real's own % is typed by you (login-gated, Pro-only) |

| — | Assistant + MCP | A chat bubble on every tab (answers from Real's docs, does the maths, opens tabs, changes your inputs, undoable; free Workers AI) and a public read-only **MCP server** at `/mcp` (button at the top right) so Instinct / Claude / Cursor can use the same tools | Real's public docs + this repo's notes (BM25), live odds/schedule via the site's own endpoints |

Every panel that can show synthetic data carries a **SAMPLE DATA** badge. Nothing synthetic is presented as live.

## Assistant & MCP

- **MCP server** — `https://rax.vivaanshahani.com/mcp` (Streamable HTTP, public, read-only). Setup for Instinct, Claude, Cursor, VS Code and stdio-only clients: [docs/MCP.md](docs/MCP.md) or the **MCP** button in the header.
- **Chat assistant** — bubble bottom-right on every tab; Cloudflare Workers AI (Qwen3-30B; free tier, capped at 8,000 neurons/day by `functions/_lib/budget.ts`; optional Groq/Gemini/Cerebras/OpenRouter fallbacks and a bring-your-own-key field), retrieval over Real's docs + these notes, can change tab parameters and undo. [docs/ASSISTANT.md](docs/ASSISTANT.md). Rebuild its knowledge base with `npm run kb`.

## Develop

```bash
npm install
npm run dev          # Vite on :5173 (proxies /api → :8788)
npm run build        # typecheck (app + functions) and build to dist/
npm run pages:dev    # serve dist/ + Pages Functions locally on :8788 (run build first)
npm test             # unit tests (vitest)
npm run db:migrate   # create the local community-market D1 tables (once; see docs/COMMUNITY-MARKET.md)
npm run kb           # rebuild the assistant's knowledge base (public/data/kb/) from Real's docs + docs/*.md
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
  market/spikes.ts     spike screen, fair-value model, candles, forecast inputs (?source=rateboard|sample)
  market/rates.ts      Rateboard bid-rate recorder: samples the board into KV, returns coverage + 7-day baselines
  market/contribute.ts community market database (D1 `MARKET_DB`): POST an anonymous capture
  market/community.ts  …and GET it back (summary / sales / auctions / stats, `minReports`) — docs/COMMUNITY-MARKET.md
  intel/schedule.ts    live game schedule from ESPN public scoreboards (Tab 6)
```

**Caching.** Responses are cached with Cloudflare's Cache API (free, no write quota) — 15 s for the Rateboard board, 60 s for live games, 300 s for profiles. Workers **KV** holds the rolling market histories (the Rateboard bid-rate change log `rbrates:v1`, plus the legacy auction document `market:v1` if a Real feed is ever configured), each written at most every 10 minutes (≤ 144 writes/day per document). `.github/workflows/rate-history.yml` pings `/api/market/rates` every ~10 min so the bid-rate history grows when nobody is on the site; `scripts/seed-rb-history.ts` rebuilds the seed from Rateboard's own rolling backups. This deviates from "cache everything in KV" on purpose: the free tier allows ~1,000 KV writes/day, which per-response caching would exhaust.

**Community market database.** An always-on, anonymous D1 database (`rax-market`, binding `MARKET_DB`, schema in `migrations/market/`) shares every Real-marketplace capture users import (the import panel says so); other users get them as the *Community* source in Tabs 2–3. It stays under D1's free tier through set-based writes, an in-code daily write budget, retention pruning and distinct-reporter verification — see [docs/COMMUNITY-MARKET.md](docs/COMMUNITY-MARKET.md) (including the terms-of-service caveat). Deploying it needs the remote migration (`npm run db:migrate:remote`, already applied) in addition to `wrangler pages deploy`.

**Why the Monte Carlo runs in the browser.** Free-tier Functions get ~10 ms CPU per request; 4,000 simulated paths don't fit. The edge only assembles inputs (`?forecastInputs=`); the simulation runs client-side, seeded and reproducible.

## Tab 1 — the Rateboard wrapper

Rateboard's JSON API sends no CORS headers, so the browser can't call it directly. `/api/proxy/rateboard` makes the **same request server-side**: board read, player search, collection pull ("Pull my cards from Real", including Rateboard's chunking and load-spreading wait), sign-up/sign-in, and post/change/remove offer. Copy-messages (`i have <rating> <player> <rating × rate, to the nearest 10>`), floors, the house list, big orders and quicksells are ported 1:1 from Rateboard's own logic and unit-tested (`shared/rateboard.ts`).

Deliberately **not** proxied:
- whole-board overwrite (`POST /api/kv {key, value}`) — a data-loss footgun
- admin operations (delete others' offers, reset passwords, data reports)
- `/api/scan` (Rateboard's paid screenshot reader — "Read screenshots on Rateboard ↗" links out; nothing here needs it)

`/api/rax` (per-game / per-season Rax logs) **is** proxied, with Rateboard's owner's permission, for the query shapes this app uses only (`shared/rax.ts` allow-list; responses cached 10 min). It powers Tab 4 and the owners / Rax chips.

Stripped before anything reaches the browser: every account's password hash, the private reports list, and the game-data grant list. Passwords are hashed **in the browser**; sign-in sends only the hash, compared server-side, never stored or logged.

Every listed card has a **Trade / List this Card on Rateboard ↗** button → `https://rateboard-cgi.pages.dev/?card={id}&action=trade`.

## Monte Carlo projections (Tab 3)

Seeded stochastic simulation — **no machine learning**. See `shared/montecarlo.ts` for the full model: fundamental level + decaying hype; seasonal drift (pre-season ramp → in-season → playoffs → post-season decay → off-season); mean reversion to an anchor shrunk toward similar cards; Student-t shocks and jumps; thin-market volatility inflation; per-path drift/vol uncertainty; observation noise that grows as volume falls; and a bounded, mean-reverting rating process (weekly in-season shocks, season-start refresh) correlated with price.

**Assumptions, not facts:** the seasonal drift sizes, hype half-life, jump frequency and rating volatility are priors, **not fitted to Real's market** — only ~30 days of price history exist, so "previous seasons" enter as priors. Re-fit them once multi-season data exists. A walk-forward test on the sample market checks the 5–95% band covers realised prices ≥ 85% of the time.

## Known limits (please read)

- **Real's own API can't be used anonymously.** It requires a login session, a signed per-request token and a Turnstile token (see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for the full findings and ways forward). The spec's spoofed-User-Agent approach would not work, and forging those tokens would be circumventing access controls, so it isn't done.
- **Real auction/sale data is not available ⇒** Tabs 2–3 default to **Rateboard standing buy offers** (bid *rates*, Rax per rating point — not sale prices; card rating and rarity are not in that data and are shown unknown). Their history only exists from when recording began (≈ 2026-10-10 via Rateboard's backups) and spikes/candles/forecasts unlock after 3 days. An imported snapshot or labelled sample data stay selectable. Poll percentages in Tab 6 remain sample (clearly badged). Everything evaluated is in [docs/MARKET-DATA-SOURCES.md](docs/MARKET-DATA-SOURCES.md). Tab 4 is live from Rateboard's Rax logs for NFL, NBA, MLB, NHL, college football / basketball and golf (not soccer, WNBA or UFC), falling back to sample data only if that feed fails; "Who to buy" ranks the top anniversaries of the selected date, not every card.
- Rateboard ignores the `?card=…&action=trade` parameters (it just opens the site), per its current source.
- Rateboard's server does not authenticate writes (it trusts the `user` field) and publishes password hashes on a public endpoint. This wrapper doesn't rely on or exploit either; it's worth telling its owner.
- Get Rateboard's blessing: this wrapper sends your users' traffic to their backend.
- Not affiliated with Real. Not financial advice.

## Tab 7 — OTD Efficiency

Two interchangeable datasets in the same shape (`shared/otdSnapshot.ts`), swapped from the tab's method panel (which also spells out the pros and cons of each):

| Method | Source | Built by | Accuracy |
|---|---|---|---|
| **Observed** | Real's own per-game Rax, as logged by Rateboard's `/api/rax` | `node scripts/build-otd-snapshot.mjs` → `public/data/otd-observed.json` | Exact where present (checked against the community top-10 lists, see [docs/OTD-DATASET.md](docs/OTD-DATASET.md)); top cards only |
| **Modeled** | Free ESPN stat lines → a fitted rating/Rax model | `node scripts/build-modeled-snapshot.mjs` → `public/data/otd-modeled.json` | Approximate; error tables in [docs/RATING-MODEL.md](docs/RATING-MODEL.md) |

How earnings are computed (`shared/otdRules.ts`, from Real's own docs — [docs/OTD-MECHANICS.md](docs/OTD-MECHANICS.md)): payout = `min(cap, multiplier × Σ General-level rax)`; multipliers run Common 2× … Mystic 10 105× … Iconic 1 150× … Iconic 20 250×, caps ≈ 500 × multiplier below Iconic (Iconic uncapped); 2 guaranteed claims per sport per day. There is no Rax "upgrade fee" — a card's level is the summed rating of the play cards you own for it, so cost = 200 + rating needed × Rax-per-rating (`shared/otdPricing.ts`, [docs/OTD-MARKET.md](docs/OTD-MARKET.md)).

`shared/otdEfficiency.ts` ranks cards standalone and builds a portfolio greedily by *marginal* payout per Rax, so cards that only duplicate days you already cover are skipped.

**Prices are estimates.** Real publishes no marketplace data; the default rate (10 Rax per rating) is the median of Rateboard's standing offers. Overwrite any card's price in the table. Unestablished rules (does the per-card cap reset yearly, how long a claim stays open, the Pro bonus win-rate) are labelled assumptions.

Refreshing the snapshots re-queries Rateboard (about 1,400 requests cold, cached on disk after) — please be gentle with its free-tier backend and re-run only when needed.

### Tab 7 additions & RaxEdge import
Timeframes now include 5 and 10 years (one year of anniversaries repeated, with a yearly-vs-lifetime cap switch), the combination picker can minimise overlap, and *My cards* can import your exact passes from RaxEdge in your own browser — see [docs/RAXEDGE-IMPORT.md](docs/RAXEDGE-IMPORT.md). `npm run dev:full` builds and runs the site together with the Functions server (needed for `/api/*`, e.g. Tab 9's odds), so local requests don't fail with 502.
