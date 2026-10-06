# Data sources — what exists, what's usable, what isn't

Findings from reading the public Rateboard site, Real's public web client and a handful of unauthenticated read-only requests (October 2026). Anything marked **inferred** is a deduction, not something observed.

## 1. Rateboard (`rateboard-cgi.pages.dev`)

A single-page app plus a small Cloudflare Pages backend. Endpoints (observed from its client code and probes):

| Endpoint | What it does | Used here? |
|---|---|---|
| `GET /api/kv?key=ratebrd_market_v1` | The whole shared board as one JSON doc: accounts, standing buy offers, per-player floors, house list, keep list, private reports | **Yes** (sanitised: hashes/reports stripped) |
| `POST /api/kv {op: …}` | Atomic edits: `signup`, `setPass`, `addOffer`, `updateOffer`, `removeOffer` (+ admin ops: `resetPass`, `dataReport`, …) | **Yes** — user ops only, shapes validated |
| `POST /api/kv {key, value}` | Overwrites the entire board | **No** (data-loss risk) |
| `GET /api/players?sport&q` | Player autocomplete from a roster index built from public sports data, refreshed in the background | **Yes** |
| `GET /api/collection?username&sport&start&hashId` | **The live bridge to Real.** Returns a user's cards per player (`name`, `total`, `totalValue`) in chunks (`hashId`, `hasMore`, `nextStart`); responses cached ~2 h (`x-cache`); errors read `RS user "x" not found` (RS = Real Sports) | **Yes** (Tab 1, 2, 5) |
| `GET /api/ufc` | UFC fighter metadata (status, age, record, division) from UFC.com, ~550 fighters | Not yet |
| `POST /api/scan` | Sends screenshots to an LLM (Rateboard's paid API key) to read a "Top players" list | **No** — their cost; link out instead |
| `GET /api/rax?…gamelog=…` | Per-game "rax" game logs across seasons (e.g. golf, 4–6k rows/season) — the data behind Rateboard's **Game data** panel, which its UI hides except for admins/grantees | **No** — deliberately access-gated |

**How Rateboard gets Real data (inferred):** its backend queries Real's authenticated API with its own session (hence the 2-hour cache and the random 0–10 s "stagger" that spreads load on Real). We can't see that code.

**Things worth telling Rateboard's owner:** the public `/api/kv` returns every account's password hash; write ops trust the `user` field (no auth); `/api/scan` and `/api/rax` are open to anyone who calls them directly.

## 2. Real's own API

Real has a public **web client** (`realapp.com` → React app served from `realsports.io`). Its hosts, read from the client bundle:

| Host | Role |
|---|---|
| `web.realapp.com`, `web.realsports.io` | The API (`GET /` → `{"success":true}`) |
| `mobileweb.realapp.com` | Mobile-web variant |
| `media.realapp.com` | **Public image CDN** (S3 behind CloudFront; returns 200 without auth) |
| `mediaservice.real.vg` | Media uploads |

Endpoints the client calls — grouped by the tab they'd serve:

- **Market / auctions (Tabs 2–3):** `/cardmarketplacelistings`, `/cardmarketplaceoffers`, `/cardmarketplaceconfiguration`, `/marketplace/fmv/…` (fair market value), `/cardauctionhistory/{id}`, `/cardtradehistory/{id}`, `/bid`, `/bidhistory`, `/bidinfo`, `/globalcards`, `/dailypurchasablecards`, `/getcardwants`, `/getmatchedusersforwants`
- **OTD / earnings (Tabs 4–5):** `/cardhistoricalearnings`, `/cardhistoricalearnings/calendar`, `/cardhistoricalearnings/info`, `/userpassearnings/day/{…}`, `/cardpulls`, `/collection/…`, `/cardalbums`
- **Users (Tab 1/2/5):** `/user/profile`, `/users/search`, `/searchusers`, `/userfeaturedcards`, `/userkarmaranks/…`, `/userstreak/…`
- **Games / polls / Quads (Tab 6):** `/games/…`, `/polls/…`, `/pollleaderboard`, `/pollrecords`, `/squads`, `/odds/games/…`, `/playerboxscores/…`

**All of it is gated.** Unauthenticated calls return `401 "Malformed request."` (or `400 "Invalid request"`). The client attaches, per request: `real-auth-info` (the logged-in user's session), `real-device-*` identity headers, `real-version`, a signed **`real-request-token`**, and a Cloudflare **Turnstile** token (`real-turnstile-token`); there is also device attestation for check-ins.

**Consequences**
- The spec's idea of calling Real from the edge with a spoofed iOS `User-Agent` could never have worked, and making it work would mean forging request tokens and defeating Turnstile — i.e. circumventing access controls. **That is not implemented and shouldn't be.** `/api/proxy/real` now sends an honest UA and is only useful for an upstream you're authorised to call.
- Using your *own* login in the edge proxy isn't free of risk either: it puts a live account session in Cloudflare, runs afoul of the signed-token scheme, and risks the account.

## 3. What is live now

| Tab | Live | Still sample |
|---|---|---|
| 1 Rateboard | Everything (board, search, pull, sign-in, offers) | — |
| 2 Scout | Collection pull (Rateboard) for matching | Auction feed, contenders |
| 3 Volatility | — | All market history |
| 4 OTD | — | Games database (import your own) |
| 5 Portfolio | Image CDN (`media.realapp.com`) + collection pull | Live-game yield (you enter it) |
| 6 Quads | **Schedule, times, broadcasters, live status** (ESPN public scoreboards, free) | Poll percentages; pace/polls are estimates |

ESPN's scoreboard JSON is unofficial and unguaranteed, but unauthenticated and free; the endpoint falls back to sample matchups if it fails.

## 4. Ways to get real auction / OTD / poll data, easiest first

1. **Ask Rateboard's owner.** They already hold a working Real connection and a per-game rax dataset (`/api/rax`). Ask for (a) read access or a key for the game-data endpoint, (b) a read-only marketplace/auction snapshot endpoint if they have one. Free, fast, and the data is built to be shared — this is the best next step.
2. **Ask Real** for API access or a partnership/data agreement. Slow but the only fully legitimate route to marketplace data.
3. **Import what you can export.** Tab 4 already accepts CSV/JSON of historical games; the same pattern could be added for auction snapshots you collect by hand. Free, manual.
4. **Not recommended:** automating a logged-in account or forging Real's request tokens — against the terms, fragile, and a ban risk.
