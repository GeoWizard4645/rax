# Market data sources — what was evaluated for Tabs 2–3, and what flows now

Survey date: 2026-10-11. Rules followed: free only, read-only, no login, no bypassing access controls, no forged tokens or Turnstile, an honest `User-Agent`, a handful of plain GET probes. Anything marked **not found** means "looked, could not find it", not "does not exist". Companion to [DATA-SOURCES.md](DATA-SOURCES.md) (which covers Rateboard's routes and Real's gated API in more depth).

## Bottom line

**No free, public, unauthenticated source of Real sale prices, auction bids, fair market value or price history exists that we could find.** Everything on Real's side is login- and signed-token-gated, and Real's Terms of Use forbid scraping. The only real market-shaped data we can read is **Rateboard's standing buy offers** (demand-side bid *rates*, Rax per rating point). Tabs 2–3 now run on those, with the history recorded going forward; imports and sample data stay selectable and labelled. The one exception is data **you** record from your own signed-in Real session — see "Real marketplace capture" below — which becomes the default source once you have captured something.

## Candidates

| # | Source | URL | Returns | Auth / limits / freshness | Permission / ToS | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Rateboard board** | `GET rateboard-cgi.pages.dev/api/kv?key=ratebrd_market_v1` | ~640 standing BUY offers (buyer, sport, player, rate per rating point, comment link, post time), per-player floors (113), house list (30), keep list (623), accounts (1,576 — hashes stripped by us) | None. Live; we cache 15–60 s | Owner (Dennis) OK'd all routes | **USED** — Tab 2 bids, Tab 3 history |
| 2 | Rateboard rolling backups | `GET /api/kv?snap=list` → 25 slots, `GET /api/kv?snap=<slot>` → the whole board at that time (~460 KB, includes password hashes, which we drop in memory) | ~25 hours of board history (one snapshot per ~30–90 min) | None; found by reading the page's admin code (`#ad-backup`); slot ids are numeric | Same permission (all routes) | **USED once** to seed history (`scripts/seed-rb-history.ts` → `public/data/rb-rates-seed.json`, 43 KB, no usernames). Re-runnable to fill gaps |
| 3 | Rateboard `fullprice` list (inside the board doc) | same `api/kv` document, key `fullprice` (4 rows) | Queued "full price" lookups: user, sport, season, player, `rax`, `owners` — season totals of Rax earned and owner counts, not prices | n/a | — | NOT MARKET DATA. Not exposed by `sanitizeBoard`; unused |
| 4 | Rateboard `?datareports=1` | `GET /api/kv?datareports=1` | `{"reports":[]}` — UFC data-quality reports | n/a | — | Not market data |
| 5 | Rateboard `/api/collection`, `/api/players`, `/api/ufc`, `/api/rax`, `/api/scan` | see DATA-SOURCES §1 | Holdings, rosters, UFC metadata, per-game Rax, LLM screenshot reader | various | OK'd | **No prices or auctions in any of them** (re-checked the client for `price`, `sold`, `trade`, `hist`, `stats`: nothing market-like beyond the board). `/api/scan` costs Dennis money; not used |
| 6 | RaxEdge routes (~100, enumerated by the user) | raxedge.com `/api/real/*` etc. | Scores, DK/FD odds, Real prediction-market probabilities, OTD passes/earnings, **pack-pull odds + avgCardValue** (`/api/real/pack-odds`), parlays, casino, admin-only portfolio | Needs the user's own RaxEdge login; no CORS → only an in-browser export works | @moe_ OK'd | No marketplace/auction/price routes. **Pack odds used** as an optional, default-off Tab 3 panel (cost of a rating point via packs vs bids), via the existing bridge |
| 7 | Real prediction markets (`/api/real/live-probs`, `/api/real/sync`) | via RaxEdge export | Win probabilities for games | as 6 | as 6 | Game odds, not card prices. Not used in Tabs 2–3 |
| 8 | Real web API | `web.realapp.com`, `web.realsports.io` | `/cardmarketplacelistings`, `/cardmarketplaceoffers`, `/cardmarketplaceconfiguration`, `/marketplace/fmv/…`, `/cardauctionhistory/{id}`, `/cardtradehistory/{id}`, `/bid`, `/bidhistory`, `/bidinfo`, `/globalcards`, `/dailypurchasablecards`, `/getcardwants`, `/getmatchedusersforwants` (names read from Real's own client bundle) | Login + signed `real-request-token` + Turnstile. Anonymous GET of `/marketplace/fmv`, `/globalcards`, `/dailypurchasablecards` → `400 {"error":"Bad Request","message":"Invalid request"}` (earlier probes of other paths: 401 "Malformed request.") | **Terms of Use ban "data mining, robots, or similar data gathering" without written permission**; forging tokens would circumvent access controls | **NOT USABLE.** Not implemented, and shouldn't be |
| 9 | Real public pages | `realapp.link/`, `realapp.com/` (301, empty body); `www.realapp.com` → title only; share links `realapp.com/<id>` | No meta tags, JSON-LD or embedded state with card prices seen | none | — | NOT USABLE |
| 10 | `media.realapp.com` image CDN | public S3/CloudFront | Card artwork only | none | used by Tab 5 | Not market data |
| 11 | Real docs | `docs.realapp.link` (index `llms.txt`, every page also as `.md`) | Mechanics prose: rax, player cards, packs, level-up, Real Pro, Real Bot, changelog, terms. **No marketplace, auction, fee or FMV pages**; the word "FMV" appears nowhere we fetched | none | public | PARTIAL — mechanics only (below). Fee %, quick-sell formula, bid increments and auction length (only "10 minute timer" and "12-hour auction" appear) are **undocumented** |
| 12 | Real Bot (in-app) | in the Real app | Per the docs it "can answer questions about card prices and the marketplace" (e.g. biggest NBA auctions) | In-app login | — | **Lead, unverified.** Worth a manual look; no public endpoint found |
| 13 | otdrax.vercel.app (OTD Rax, by @Knies / @paolo) | site | Earnings rank tables, rarity multipliers, compare, an unfinished "Who to Buy" | none | unknown | Earnings tool, no marketplace prices. Its network calls were not inspected. Owners are worth asking if they hold sales data |
| 14 | GitHub / npm / PyPI | repo search for `realapp rax cards`, `realsports cards marketplace`, `cardmarketplacelistings`, `cardauctionhistory`, `web.realapp.com` | 0 results | — | — | **Not found** |
| 15 | Reddit (r/realapp etc.) | — | — | Blocked to our tools | — | **Not checked** (not "confirmed empty") |
| 16 | X / Twitter | official `@realapp` posts | Announcements (rarity multipliers, features), no price logs | — | — | Not usable. No readable thread with price tables found |
| 17 | YouTube | e.g. "The Real Sports Auction House Is Awful!" and Rax-making guides | Titles only; no transcripts reachable | — | — | Anecdotal at best |
| 18 | Google Sheets / Notion / Airtable trackers, Discord bots, Discord-recap blogs, newsletters, other Rateboard-like boards | web search | Only generic physical-card trackers (CollX, Market Movers…) | — | — | **Not found.** Real's Discord is mentioned by support text but no invite or price channel was found |
| 19 | App Store listing | apps.apple.com | Rax IAP prices (400 for $4.99 … 14,000 for $49.99), Pro $7.99/mo | — | — | Context only |

### Mechanics worth knowing (from Real's changelog and docs)

- 2025-06: auction house for Pro — Pro members list cards for a set duration; others bid Rax. 2025-07: offers on play/performance cards; an accepted offer becomes a **12-hour auction with the offer as first bid**; bid/offer balances are held. 2025-08: Marketplace tab, **target price** auctions with a **10-minute timer**, **Quick sell** (to Real). 2025-09: bulk quick sell, cancel listings/offers, marketplace opened to high-karma non-Pro users. 2026-05: counter-offers. Not documented: fees, quick-sell price, increments, FMV method.
- Because quick-sell and listing happen inside the app, **no public record of sales exists** for us to read.

## What flows into the tabs now

| | Source | What is real | What is unknown / still sample |
|---|---|---|---|
| **Tab 2 · Live (default)** | Rateboard board (client fetch via the existing proxy, 60 s refresh) | every standing offer as a "bid": buyer, player, sport, **rate per rating point**, posted time, comment link; floors and house rates; premium vs the going rate (own 7-day median once ≥ 3 days are recorded, else the other buyers' median, else the sport median — flagged in each row); repeat bidders; your collection matched to buyers (Rateboard's own matcher, message and owed formula) | card **rating and rarity** (shown "unknown"), auction timers, highest-bid/sale history, whether a buyer holds copies. No "live auctions", no Mystic/Legendary filter. Usernames are Rateboard accounts, not necessarily Real handles → contact is the buyer's own comment link |
| Tab 2 · Imported | the user's own Real session (existing schema-agnostic importer) | whatever they paste | unchanged |
| Tab 2 · Sample | synthetic | — | everything (badged SAMPLE DATA) |
| **Tab 3 · Live (default)** | Rateboard board, **recorded over time** (`/api/market/rates`, KV) | current best/median bid rate and buyer counts per player; history of those; spikes in best rate or buyer count; candles of the best bid rate; Monte Carlo of the bid rate; a depth-vs-rate scatter | **sale prices, fair value, ratings, rarities** — none exist in the data. The scatter is rate vs buyers (not fair value). Spikes/candles/forecast stay off until ≥ 3 days (≥ 48 sampled hours) and say how many days exist |
| Tab 3 · Imported | the Tab 2 import, series built in the browser | whatever the snapshot has | short window → spikes rare |
| Tab 3 · Sample | synthetic | — | everything |
| Tab 3 · optional panel (off) | RaxEdge pack odds (user's export) + Rateboard best bids | per-player pack cost per rating point next to the best bid | pack price is an assumption (editable); pulls random; fees ignored |

## How history accumulates

- `GET /api/market/rates` (also called by Tab 2/3 and by `.github/workflows/rate-history.yml` every ~10 min) reads the board (Cache API, 60 s), appends a sample to one KV document `rbrates:v1`, and persists it **at most once per 10 minutes**.
- The document is a **change log**, not a time grid: per player, `[t, best, median, buyers, offers, house]` only when something changed (bid rates are sticky — 1.1 days of backups changed for only ~6% of players). Hourly series are rebuilt by forward-filling across the UTC hours that were actually sampled; unsampled hours stay gaps. Size ≈ 50–200 KB for 35 days.
- Seeded from Rateboard's own 25 rolling backups (≈ 1.2 days) so day 0 is not empty; `seeded` is shown in the UI. Re-run `scripts/seed-rb-history.ts` to fill a gap.
- Guards: an empty board, or one whose offer count halves versus the last sample, is not recorded.
- **Useful when:** current rates, buyers and the scatter — day 0. Spikes, candles and forecasts — after 3 days of span with ≥ 48 sampled hours — the seed starts at 2026-10-10 00:09 UTC, so with continuous recording that is **about 2026-10-13**. A forecast needs ≥ 5 days of per-player history. 30-day candles/forecasts are meaningful after ~2–4 weeks. Honest expectation: most rates are flat for days; spikes will be rare.
- **KV write budget:** ≤ 144 writes/day (one per 10 min) out of ~1,000/day free; reads go through a 30-s isolate memo and 60-s Cache API response caching. The legacy `market:v1` document is untouched. If GitHub's scheduler skips runs, history only gets gaps. Without a KV binding the recorder works in memory only and the UI says so.

## What we could not find (be skeptical)

Any public JSON/HTML with card prices, auctions or FMV; any share-link metadata; any repo/package/spreadsheet/newsletter/bot dataset; any machine-readable sale log; any Reddit content; any YouTube transcript; any other Rateboard-like board. The "Real Bot" may answer price questions but only inside the app.

## Real marketplace capture (Tabs 2–3, the default when you have captured something)

Added 2026-10-11. This is the only route to **real** auction bids, sale prices and fair values, and it works because the data is already on *your* screen: Real's web app shows every Marketplace auction and, per card, a "Market data" view with its own median price, price per rating, total sales, quartiles and a list of recent sales.

**How it works.** `shared/realMarketCapture.ts` holds a recorder snippet (also offered as a bookmarklet). You run it on realapp.com, signed in as yourself. It adds a small box, **only reads the text already on the page** every ~1.2 s while you browse, makes no requests, clicks nothing, touches no cookies/tokens/headers, and sends nothing; a unit test asserts the code contains no `fetch`/XHR/WebSocket/beacon/`.click()`/cookie access. **Export** copies JSON, which you paste into the "Capture real Real-marketplace data" box in Tab 2 or 3. Imports **accumulate** in this browser's localStorage (`src/lib/realMarketStore.ts`, key `rax_real_market_v1`); importing also shares the capture anonymously (below). Real's terms discourage bulk data mining, so the point is to record what you personally look at, at human speed.

**Sharing (always on).** Since 2026-10-11 every import is also shared anonymously: the capture panel says so beside the Import button, there is no setting, and everyone else can select the data as the **Community** source (verified-only by default: a row counts once ≥ 2 independent contributors reported it). Only what is in the export is sent; no username, account or IP is stored. Real's terms discourage bulk data mining and redistributing others' data, and a pooled database of what many people looked at is still a redistributed dataset — see the caveat in [COMMUNITY-MARKET.md](COMMUNITY-MARKET.md). Architecture, free-tier numbers, privacy and the poisoning model are there too.

**What is recorded**

| Part | Fields | Notes |
|---|---|---|
| Auctions | sport, season, rarity, card type, rating, play, player, team, serial, **current bid**, bid count, watchers, **time left**, `seenAt` | one row per auction on screen. Merged by sport\|serial\|player\|type\|rating; the latest sighting wins and every *differing* sighting is kept as its own `seenAt` point (bid history), runs of identical sightings keep only first + last, max 40 points. A card seen again after its timer ran out is counted as a relisting and its history restarts |
| Sales | player (often abbreviated, "B. Robinson"), rating, rarity, serial, price, price per rating, timestamp, outcome filter | from a card's Market data → Recent activity. Deduped by `saleKey`. **Only `Sold` (or an unread filter) counts as a sale price**; Accepted / Open / No Sale rows are kept but excluded from every price statistic (an accepted offer becomes an auction per Real's changelog, so it is not a final price) |
| Market stats | median, median per rating, total sales, premium ×, min, max, 25th–75th percentile, scope (Card / Player / Similar), window (30d) | Real's own numbers as displayed. Deduped by name+serial+scope+window+day |

**Storage guards (local).** One write per import; sales are stored as compact tuples; newest **20,000** sales kept; auctions dropped 14 days after they end; summaries dropped after 90 days; the whole store is shrunk to ~3.5M characters (stale auctions first, then oldest sales) and, if the browser still refuses (quota), retried smaller. The import message says exactly what was dropped.

**Reference prices for the overpriced radar (Tab 2)** — per rating point, first one resting on **≥ 5 sales** wins; if none does, the best one is shown but **no premium is computed**:
1. Real's own median per rating for the same card (stats, scope Card; matched by name + rating + rarity, the serial the view was opened on is ignored because the stat covers all copies);
2. the same for the same player (scope Player);
3. median of captured sales of the same sport + rarity + card type (sales carry no sport or type, so they are resolved through the auctions you captured: initial + surname + rating + rarity must identify exactly one sport/type, otherwise the sale is left out);
4. median bid per rating of the other live auctions of that sport + rarity + type (**bids, not sales**);
5. last resort, flagged weak: median of all captured sales of that rarity.
Premium = (bid ÷ rating) ÷ reference − 1. Example from the real fixture: Bijan Robinson 2.6 Common #1353, current bid 110 → 42.3 per rating against Real's own 31 (529 sales, 30 d) = **+36.5%**.

**Tab 3 on this source.** Daily median price per rating and sales count (UTC days, gaps stay gaps) per card and pooled by rarity / sport+rarity / sport+rarity+type; candles from the individual sales; Real's stats as a fair-value table with its age; price-spike screener (24 h median sale price vs the seven earlier 24 h windows, needs ≥ 3 recent sales, ≥ 3 earlier windows with ≥ 2 sales each, ≥ 10 in all, z > 2 and ≥ +15%); bid-vs-fair scatter (live auctions × references with ≥ 5 sales); Monte Carlo only with sales on **≥ 5 distinct days** for that series (otherwise it says how many days exist). Windows end at the newest captured sale, not at "now". Volume is deliberately never tested for spikes (see below).

**Limits — read these**
- **Bidders are unknown.** Cards on the Marketplace don't show who is bidding, so nothing is invented: Proactive Scout and Repeat Contenders cannot run on this source (they still work on Rateboard / Imported).
- **Only what you opened.** Auctions you scrolled past, cards whose Market data you opened. The recent-activity list is the latest N sales, so captured sales per day measure how long that list was, not market volume.
- **Price-history chart values are not in the page text** (they are drawn graphics), so history is built from individual sales and market-data snapshots and only grows as you capture on more days.
- **"Premium ×" is Real's own number and its meaning is unverified** (it may be a serial-number premium). It is displayed in the fair-value table and used in no calculation. Our premium is our own formula above.
- Time left is shown rounded to one unit ("4h", "5d"); an auction past `seenAt + timeLeft` is "timer ran out" for one more unit and "ended · stale" after that. Whether late bids extend an auction is unknown.
- Player matching between abbreviated sale names and full names uses initial + surname; two players sharing both would be conflated.
- Per-card/player stats are 30-day windows as of when you opened them; their age is shown.
- Mixed-rating pools use price ÷ rating, which is not constant across ratings; the weak rarity-wide reference is a rough yardstick.

## Older fallback: copy responses from DevTools

See [CAPTURE-GUIDE.md](CAPTURE-GUIDE.md) — the manual copy-paste-from-DevTools flow and the three response captures to ask the user for, if the recorder ever stops working after a Real redesign.
