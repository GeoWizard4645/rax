# Community market database (always-on, anonymous, free)

A shared store for the Real-marketplace captures described in [MARKET-DATA-SOURCES.md](MARKET-DATA-SOURCES.md#real-marketplace-capture-tabs-23-the-default-when-you-have-captured-something). Every time someone imports a capture (there is no setting; the import panel says so next to the button), the same capture is saved to a Cloudflare D1 database and every other RAX user can select **Community (shared by RAX users)** in Tabs 2–3. It costs nothing: Cloudflare D1 free tier, no card.

Sharing itself is not optional, but nothing else depends on it. With the community database empty or not connected, the app behaves exactly as before; local captures remain first in the default-source order.

## Terms-of-service caveat (please read)

Real's Terms of Use discourage bulk data mining and redistributing other people's data. This feature does **not** make that go away. The recorder only reads what a signed-in user personally has on screen, at human speed, but a pooled database of what many users looked at is still a redistributed dataset, and since sharing is automatic on import, **the operator, not just the importer, is responsible for it**. The import panel tells users plainly that importing shares, so nobody shares by surprise. The site operator can wipe the database at any time (below). Nothing here is Real's own feed, and nothing in it is verified against Real.

## Architecture

```
browser (RealCaptureImport)  --POST {capture, contributor}-->  /api/market/contribute  --D1 batch-->  MARKET_DB (rax-market)
Tabs 2–3 (useCommunityMarket) <--GET ?kind=summary|sales|auctions|stats--  /api/market/community  <--Cache API 60 s--  MARKET_DB
```

| Piece | File |
|---|---|
| Schema (one migration) | `migrations/market/0001_market.sql` (own folder so `wrangler d1 migrations apply` for the odds DB, which uses `migrations/`, never touches it) |
| Validation + plausibility | `functions/_lib/marketValidate.ts` |
| Write path, budget guard, pruning | `functions/_lib/marketDb.ts` |
| Read queries | `functions/_lib/marketRead.ts` |
| Endpoints | `functions/api/market/contribute.ts`, `functions/api/market/community.ts` |
| Client: settings, fetch, upload | `src/lib/communityStore.ts`, `src/hooks/useCommunityMarket.ts`, `src/components/CommunityData.tsx`, `src/components/RealCaptureImport.tsx` |
| Rows → the existing structures, combining with a local capture | `shared/communityMarket.ts` |

Community rows are converted back into the **same `RealStore` structures** as a local capture (`shared/realMarket.ts`), so every existing calculation (radar, reference prices, premiums, spikes, candles, forecasts) runs on them unchanged.

### Binding

`wrangler.toml`: `[[d1_databases]] binding = "MARKET_DB"`, `database_name = "rax-market"`, `database_id = "8026e213-9092-4c9a-baeb-63df94d12e6e"`, `migrations_dir = "migrations/market"`. Pages reads bindings from `wrangler.toml`; without the binding both endpoints answer `503 no_db` and the app hides the community UI.

## Schema

All tables are `WITHOUT ROWID` (the text key *is* the table: one write instead of two).

| Table | Key | Purpose |
|---|---|---|
| `sales` | `sale_key` = normalised `player\|serial\|minute\|price\|rating\|rarity` | one row per distinct sale: sport/type (only when the same capture's auctions identify the card unambiguously), rating, rarity, price, per_rating, `at` (epoch ms, minute), outcome, first_seen, last_seen, **reports**. Indexes: `idx_sales_at`, partial `idx_sales_verified (at) WHERE reports >= 2` |
| `sale_reports` | `(sale_key, contributor_hash)` | who reported it, plus `net` (see anti-abuse). Distinct reporters = `reports` |
| `auctions` | `auction_key` = `SPORT\|serial\|player\|TYPE\|rating` | latest state: bid, bids, watchers, `time_left_sec`, `end_at`, first/last_seen, `npts`, **reports**. Index `idx_auctions_seen` |
| `auction_points` | `(auction_key, seen_at)` | bid history, one point per bid change, ≤ 24 per auction |
| `auction_reports` | `(auction_key, contributor_hash)` | as `sale_reports` |
| `stats` | `stat_key` = `name\|serial\|scope\|window\|day\|median\|totalSales` | Real's own market-data figures; index `idx_stats_seen` |
| `stat_reports` | `(stat_key, contributor_hash)` | as above |
| `contributors` | `contributor_hash` | first/last seen, count: only used to count reporters |
| `rate_limits` | `bucket` | hourly counters per contributor and per network bucket; expire after 2 h |
| `meta` | `k` | row-count estimates, estimated writes per UTC day, last prune/recount, last contribution, summary JSON |

Deviation from the brief: the sale key also contains rating and rarity. A forged variant of a real sale then becomes its own row that nobody corroborates, instead of occupying the real sale's key and blocking it.

## Limits per contribution (hard)

Body ≤ 300 KB, ≤ 400 auctions, ≤ 500 sales, ≤ 100 stats (over the limit: the whole request is refused with 413, nothing is truncated). Rating 0.1–12; price/bid 0–5,000,000; rarity one of COMMON…ICONIC; serial `#digits`; sport in the known set; player names letters/digits/basic punctuation, 2–64 chars. Sales: timestamp ≤ 5 min in the future and ≤ 120 days old; per-rating within 5% of price ÷ rating (or half a Rax: Real rounds to whole Rax); outcome one of Sold/Accepted/Open/No Sale. Auctions/stats must have been seen in the last 7 days. Market stats must satisfy min ≤ q1 ≤ median ≤ q3 ≤ max. Rows that fail are **dropped, not repaired**, and the response counts them by reason (`dropped.reasons`).

## Free-tier headroom

D1 free tier (check Cloudflare's current limits): 5 GB storage total (500 MB per database), 5 million rows read/day, **100,000 rows written/day**. Rows written include every index entry. The write limit is the binding one:

| Operation | Row writes |
|---|---|
| new sale | 3 (row + `idx_sales_at` + report) |
| a second reporter on a known sale | 2 (report + counter update; +1 once when it enters the verified index) |
| new auction | 4 (row, index, first bid point, report) |
| updated auction | ≤ 4 |
| new market view | 3 |
| fixed cost per contribution | ~11 (contributor, 2 rate-limit counters, 5 meta rows, …) |
| rows already reported by the same contributor or network | **0** |

A full-size contribution (500 new sales + 400 new auctions) is ≈ 3,100 writes (the code estimates it before writing); the fixture capture (9 + 10 + 1 rows) costs ≈ 80. The in-code guard (`BUDGET` in `marketDb.ts`) refuses further contributions once **estimated writes today reach 70,000** (≈ 22 full-size contributions or ≈ 850 fixture-sized ones a day; refused with `503 daily_budget`, "try again after 00:00 UTC"). That leaves 30% headroom for pruning deletes (also writes), retries and the estimate being a little low. Reads: a contribution reads a few hundred rows; a cached GET costs one read per row returned, once per query per minute per data centre (a 2,000-sale list is at most ~2.9M reads/day if one query were requested uninterrupted in one data centre for 24 h; the summary reads ~10 rows). Storage: ~400 bytes per sale including reports and indexes → the 150,000-sale cap is ~60 MB.

Caps (`BUDGET`): sales 150,000, auctions 30,000, stats 30,000, total rows 300,000 (above it new contributions are refused until the hourly prune makes room).

## Retention and pruning

Inside the contribute path, at most once an hour (a lease row in `meta` claimed with a conditional `UPDATE`, so two requests can't both prune), via `waitUntil`: sales older than **120 days**, auctions not seen for **14 days** (≈ ended + 14 days), stats older than **60 days**, expired rate-limit rows, contributors idle 180 days, old per-day write counters — each with their report rows and bid points. Per-table deletes are bounded to 2,000 rows a run (each delete is a write). If a table is over its cap, the oldest rows go. Exact row counts and coverage by sport are re-read only every 6 hours (`COUNT(*)` reads every row) and stored in `meta`; between recounts the summary uses counters the write path keeps.

## Privacy: what is and isn't stored

Stored: the rows in the export the contributor imported (cards, prices, timestamps, bids, Real's market stats); a **contributor hash** = `SHA-256(constant pepper + random 128-bit id)` (the id is generated once in the contributor's browser, `localStorage` key `rax_community_id_v1`); and `net`, **20 bits** of a salted hash of the network address (about 4,000 addresses share each value), used only so one network can't vote twice.

Never stored: IP addresses, usernames, Real accounts, user agents, cookies, anything from the capture beyond what is listed (the capture format has no personal data: bidders are not on Real's cards). The rate limiter keys are hashes that include the hour. A unit test dumps every table and asserts no IP and no raw contributor id appears. Honest limits: the contributor hash is a stable pseudonym (all your contributions link to each other); rows can't be withdrawn individually (they expire; the operator can delete); the pepper is in the repo, so the hash protects a *random* id, not a guessable one.

## Poisoning model, and its honest weaknesses

Anyone can POST, so assume some contributions are lies.

1. **Plausibility** (above) rejects rows Real could not have produced. It cannot tell a believable fake from a real row.
2. **Distinct reporters.** `reports` = number of distinct contributors on distinct networks who reported the same row. One contributor id gets one vote (primary key), and one network gets one vote (`net`), so spamming new random ids from one machine adds nothing. The read side offers `minReports`; **"Verified" = `minReports ≥ 2`**, and the app's **Verified only** toggle (default ON) uses it for the premium and spike calculations. Sales and market views are deterministic, so honest users who looked at the same sale converge on the same key.
3. **Forgeries don't overwrite.** Keys contain the values, so a fake variant is a separate, unverified row; the true row still collects its honest reporters.
4. **Rate limits**: 12 contributions an hour per contributor id and per network bucket (hashed counters in D1, plus a first-line Cache API counter); invalid requests never reach D1.
5. **Budget guard** caps total damage to storage and quota.

Weaknesses: (a) an attacker with several networks (VPN, botnet, phone + home) can still make 2 reports agree on a lie; the barrier is effort, not cryptography. (b) With few users, honest rows reach `reports ≥ 2` slowly (so Verified only may show little at first). (c) Two housemates behind one NAT count as one reporter. (d) **Live auction state is latest-wins** (bids change): a fake bid on a real auction shows until the next real sighting; `reports` there means "distinct people who saw this auction", not "agree on the bid". (e) A flood can spend the day's write budget (the cost is a denied contribution until 00:00 UTC, never a bill). (f) Nothing is verified against Real. (g) Abbreviated vs full player names in different views create separate sale rows, which slows convergence.

## API

`POST /api/market/contribute` `{ capture, contributor }` → `{ ok, accepted, new, duplicates, corroborated, alreadyYours, dropped{…, reasons}, estimatedWrites, message }` (each a `{auctions, sales, stats}` count). Errors: 400 bad body, 413 too large, 422 nothing valid, 429 rate limited, 503 budget/row cap/no DB. Example message: `12 new rows shared · 3 already known`.

`GET /api/market/community?kind=summary|sales|auctions|stats&sport=&since=&minReports=&limit=` — CORS-open, no auth. `summary`: rows per kind, verified counts, contributors (and last 30 days), last contribution, coverage by sport. Lists: newest first, every row has `reports`; limits default 2,000 sales / 1,500 auctions / 1,000 stats (max 5,000 / 3,000 / 3,000); auctions include earlier bid points; `since` is rounded down to the hour.

**Caching.** GET responses are stored in the Cache API for 60 s per normalised query (`public, max-age=60`; `x-cache: HIT|MISS`), so D1 sees about one read per distinct query per minute per data centre. Writes are never cached. The browser also keeps the loaded rows for 60 s and filters the verified view client-side (toggling it is instant).

## In the app

- **Import** (`RealCaptureImport`): no checkbox; a plain-language notice that importing shares anonymously. After a successful local import the same capture is POSTed and the result shown ("20 new rows shared · 0 already known"). A failure never blocks the local import.
- **Source "Community (shared by RAX users)"** in Tabs 2 and 3 (and the assistant's `source` parameter, value `community`). Default order: your own capture; else Community when it has (verified) data; else the previous order. Every badge reads "Community database · N reporters · updated <age>". Options: **Verified only** (default ON) and **include my local capture** (de-duplicated by sale key / auction key / market-view key; default ON when you have one).
- **"Community data" line** in both tabs: rows, reporters, last update, "How to contribute" (opens the capture panel).

## Operations

Local development: `npm run db:migrate` (applies `migrations/market` to the local D1 under `.wrangler/`), then `npm run build && npm run pages:dev` and `npm run dev` (or `npm run dev:full`). **No `--d1` flag is needed**: `wrangler pages dev` takes the `MARKET_DB` binding from `wrangler.toml` and uses the same local database that `db:migrate` filled (passing `--d1 MARKET_DB` would point at a different, empty local database). To try it: POST the fixture twice with different ids and different `CF-Connecting-IP` headers (the header is only trusted because Cloudflare overwrites it in production), then `GET /api/market/community?kind=sales&minReports=2`.

Remote schema: `npm run db:migrate:remote` (already applied for `rax-market`). New schema changes go in `migrations/market/0002_….sql`.

Export: `npx wrangler d1 export rax-market --remote --output market.sql` (or `--table sales` and `--no-schema`; add `--local` for the local copy).

Wipe everything (keeps the schema):
```bash
npx wrangler d1 execute rax-market --remote --command "DELETE FROM sales; DELETE FROM sale_reports; DELETE FROM auctions; DELETE FROM auction_points; DELETE FROM auction_reports; DELETE FROM stats; DELETE FROM stat_reports; DELETE FROM contributors; DELETE FROM rate_limits; UPDATE meta SET v = '0' WHERE k NOT LIKE 'writes:%'; DELETE FROM meta WHERE k = 'summary'"
```
Delete one contributor's data: not possible by design (only a hash is kept and rows are shared); remove individual rows by `sale_key` in `sales` and `sale_reports`.

Switch the feature off: remove the `[[d1_databases]] MARKET_DB` block (the endpoints answer 503 and the UI hides itself) or delete the database.

## Tests

`tests/functions/market-community.test.ts` runs the real endpoints against the real migration on **Node's built-in `node:sqlite`** wrapped as a small D1 lookalike (`tests/functions/_d1shim.ts`), so the SQL (`json_each`, `UPDATE … FROM`, partial index, `ON CONFLICT`) is executed, not mocked. It does not simulate Cloudflare's row-write meter or Cache API. `tests/lib/community-market.test.ts` covers the client-side conversion, combining and settings.
