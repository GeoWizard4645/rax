# Odds sources for Tab 9 (Edge / EV)

Everything here is **free, keyless, read-only and public**. Snapshot taken 2026-10-10/11 from real requests; the response shapes below are what the recorded fixtures in `tests/fixtures/odds/` contain. All three feeds are unofficial or semi-official and can change without notice — every parser is defensive and a failing source never fails the API (`sources[]` reports it).

Code map: `functions/api/odds/events.ts` (I/O) → `shared/oddsSources.ts` (pure parse + match + fan-out planner) → `shared/oddsConsensus.ts` (fair probabilities) · contract in `shared/odds.ts`.

## Why not FanDuel (or any other sportsbook)?

FanDuel has **no public API**; its prices are served from private, bot-protected endpoints meant for its own apps. Scraping them (or any sportsbook's private API) would bypass access controls and break their terms, so it is deliberately not done — RaxEdge's paid FanDuel feed is the one thing this tool cannot replicate for free. The free sportsbook line we do get is **DraftKings, which ESPN publishes inside its own public JSON** (ESPN displays it next to every game). Exchanges (Kalshi, Polymarket) are the cross-check.

## 1. Kalshi — public market data

`GET https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=<SERIES>&status=open&limit=1000&max_close_ts=<unix>`

No key, no cookies. One call per series (comma lists / repeated `series_ticker` are rejected with 400/empty). Prices are **dollar strings** (`"0.4800"` = 48c).

| Field | Meaning |
|---|---|
| `event_ticker` | `<SERIES>-<YYMMMDD>[HHMM]<AWAY><HOME>` e.g. `KXNHLGAME-26OCT11SEAWSH` (soccer: HOME first). The suffix after the series is **shared** by the game, spread and total series of the same game → used to join them. |
| `ticker` | `<event_ticker>-<CODE>` — the YES team's code (`-WSH`), or `-TIE`; spreads `-SEA8` (strike 7.5), totals `-64` (63.5) |
| `yes_sub_title` | team name (`Washington`, `Los Angeles C`, `Tie`) or `Seattle wins by over 7.5 points` / `Over 63.5 points` |
| `yes_bid_dollars` / `yes_ask_dollars` (+ `_size_fp`) | top of book. **Mid** is used; `ask − bid` → `OddsMarket.width`; min(bid size, ask size) → `liquidity` |
| `last_price_dollars`, `volume_fp`, `open_interest_fp` | last trade; contracts traded. Used as a fallback price only if a book is one-sided **and** there is volume |
| `floor_strike` | spread / total line |
| `occurrence_datetime` | **expected END** of the game (see timing) |
| `close_time` | ≈ start + 2 days |
| `updated_time` | quote time |

Series used (`KALSHI_SERIES`): `KXNBA|NHL|MLB|WNBA|NFL|NCAAF{GAME,SPREAD,TOTAL}`, `KXNCAAMB{GAME,SPREAD,TOTAL}` (men's college basketball), `KXUFCFIGHT`, `KXUFCROUNDS`; soccer `KXEPL|UCL{GAME,SPREAD,TOTAL}` and `KXLALIGA|SERIEA|BUNDESLIGA|LIGUE1|UEL|MLS GAME`. Coverage today: NFL, NHL, NBA, CFB, MLB (postseason), EPL/La Liga/Serie A/Bundesliga/Ligue 1/UCL/MLS rich; WNBA, college basketball, UFC returned **0 open markets** (off-season / card not listed yet).

Handling
- Moneyline: one binary contract per team (+ `Tie` for soccer → 3-way). Each team's YES **mid** is the outcome price; they sum to ≈ 1 (± bid/ask noise), the consensus re-normalises.
- Spread: "X wins by over N.5" = X covers −N.5. Mapped to the **home team's line**; the other side is the complement (`1 − p`). Alternate strikes are limited to the 6 per game nearest 50/50 (and 8–92%).
- Total: YES = Over `floor_strike`.
- Skipped: empty/one-sided books with no volume, books wider than 30c, markets whose status isn't active.
- **Rate limit:** roughly ≥10 requests/second from one IP gets HTTP 429. Kalshi calls are paced (3 workers, 220 ms pause ⇒ ≈ 8 req/s) with one retry after 700 ms.
- **Timing:** start = `occurrence_datetime` − 3 h for NFL/MLB/NBA/WNBA/NHL (calibrated against ESPN & Polymarket exact times: offset was 0.0–0.5 h across 100+ games). For **college football/basketball, soccer and UFC** `occurrence_datetime` is a placeholder (e.g. noon ET for a 10:30 pm game), so those are matched by the **local date in the ticker** and flagged `startApprox` if no other source gives a time.

## 2. Polymarket — Gamma API

`GET https://gamma-api.polymarket.com/markets?tag_id=<TAG>&active=true&closed=false&end_date_min=<iso>&end_date_max=<iso>&sports_market_types=moneyline&order=endDate&ascending=true&limit=100`
and, for spreads/totals: `…&sports_market_types=spreads&sports_market_types=totals&order=liquidityNum&ascending=false&limit=80`

No key. **Use `/markets`, not `/events`:** an NFL game *event* is ~1 MB (hundreds of strike markets + props); the `/markets` filtered by `sports_market_types` is ~10 KB for a full slate. `series_id` is ignored by `/markets`; use `tag_id`. Ordering spread/total by `liquidityNum` desc surfaces the near-50/50 main lines first.

| Field | Meaning |
|---|---|
| `outcomes` / `outcomePrices` | JSON **strings**: `["Kraken","Capitals"]` / `["0.345","0.655"]`. Price = mid, or last trade if the book is wide — what the site displays |
| `sportsMarketType` | `moneyline`, `spreads`, `totals` (+ props we ignore) |
| `line` | spread: applies to `outcomes[0]` (`Spread: Capitals (-1.5)` ⇒ −1.5); totals: the number, `outcomes = [Over, Under]` |
| `bestBid`, `bestAsk` | book of outcome 0 → `width` |
| `volumeNum`, `liquidityClob` / `liquidityNum`, `acceptingOrders` | USD volume; book liquidity (inflated on some spreads, informational only) |
| `gameStartTime` | `"2026-10-11 21:00:00+00"` — **exact start** |
| `endDate` | game start for most leagues, **start + ~8 days for MLB** (`PolyTagSpec.endLagDays`) |
| `events[0].slug/title` | `nhl-sea-wsh-2026-10-11`, `Kraken vs. Capitals` — US sports list the **away** team first, soccer/UFC the home/first |
| soccer | three Yes/No markets per game (`…-hul`, `…-draw`, `…-eve`, `groupItemTitle` = team or `Draw (A vs. B)`) → assembled into one 3-way moneyline |

Tags (`POLY_TAGS`, verified to return data): NBA 745, NHL 899, MLB 100381, WNBA 100254, NFL 450, NCAAF 100351, UFC 279, EPL 306, La Liga 780, Serie A 101962, Bundesliga 1494, Ligue 1 102070, UCL 100977, UEL 101787, MLS 100100. (`/sports` lists *primary* tag ids; they are **not** always the ones markets are tagged with — UCL 1234 and Serie A 100618 return nothing.) College basketball (tag 101178) has no markets yet.

The public CLOB midpoint is **not** used: Gamma's `outcomePrices`/`bestBid`/`bestAsk` already carry it, and it would cost one extra request per market.

## 3. ESPN — DraftKings lines

Preferred feed (compact "header"): `GET https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=<sport>&league=<league>&dates=YYYYMMDD` → `sports[0].leagues[0].events[]`, one `odds` object per event (UFC: one event per bout, with `homeAway` fighters). ~13 KB for an NFL Sunday vs ~230 KB for the full scoreboard, and it lists *more* odds-bearing games (CFB: 6 vs 2). The full scoreboard shape (`site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard?dates=…`, odds under `competitions[0].odds[]`) is also parsed — same schema.

- `dates` is a single **US-Eastern day** (ranges `YYYYMMDD-YYYYMMDD` → HTTP 400). We request today, +1, (+2 for single-sport calls). Finished days are large (header NHL "today" after the games: ~390 KB).
- `odds.provider.name` = `DraftKings`. `moneyline.{home,away,draw}.{open,close}.odds`, `pointSpread.{home,away}.close.{line,odds}`, `total.{over,under}.close.{line:"o6.5",odds}`; `"OFF"` strings for unavailable markets; soccer adds `draw`. `close` = the current line (ESPN's naming), `open` = opening line. `odds` is `[null]`/absent when no line is posted. **Lines only appear about a day before the game and disappear when it finishes.**
- Deep link: the scoreboard's tracking URL carries `preurl=https://sportsbook.draftkings.com/event/<id>`; only that clean URL is exposed.
- ESPN's CDN 403s unfamiliar `User-Agent`s on some hosts (see `functions/api/intel/schedule.ts`), so **no custom UA is sent to ESPN**; Kalshi/Polymarket get `rax-super-suite/0.1 (+https://rax.vivaanshahani.com)`.
- Leagues: `basketball/nba`, `hockey/nhl`, `baseball/mlb`, `basketball/wnba`, `football/nfl`, `football/college-football`, `basketball/mens-college-basketball`, `mma/ufc`, soccer `eng.1 esp.1 ita.1 ger.1 fra.1 uefa.champions uefa.europa usa.1`.
- ESPN also yields the **exact start time and home/away orientation**, so it anchors the matcher. `summary?event=` (`pickcenter`) was not needed.

## Free-tier budget (Cloudflare Pages Functions)

Free plan: **50 subrequests** and ~**10 ms CPU** per invocation. `planFanout()` builds the call list and trims by priority (1 moneyline calls + ESPN today · 2 ESPN tomorrow · 3 Kalshi spread/total · 4 Polymarket spread/total) to ≤ 44 (headroom for 429 retries; retries are capped so the total stays ≤ 50).

| Request | Calls (Kalshi / Polymarket / ESPN) | Total |
|---|---|---|
| `sport=NBA`, `NHL`, `MLB`, `WNBA`, `NFL`, `CFB`, `CBB` | 3 / 2 / 3 | **8** |
| `sport=UFC` | 2 / 2 / 3 | 7 |
| `sport=FC` (8 leagues) | 12 / 8 / 24 | **44** (ESPN = 8 leagues × 3 days; exactly at the planner's cap) |
| `sport=ALL` (everything except FC; "lite") | 8 / 8 / 16 | **32** |
| any sport with `&markets=ml` | skips Kalshi spread/total + Polymarket spreads/totals | 5 for NBA |

`ALL` and `markets=ml` leave out the exchanges' spread/total feeds, which are the bulk of the bytes (Kalshi NFL spread series alone is 650 KB). Measured on warm Node (a proxy for V8 on the edge): NBA 2.4 ms, NHL 5.5, NFL 6.1, FC 7.6, ALL 8.0 ms of parse+match CPU (payloads 0.7–2.3 MB) — close to the 10 ms free-tier CPU line on busy days, which is why **the UI should call per sport** (each its own invocation + cache entry) rather than rely on `ALL`. Responses are cached 45 s with the Cache API (no quota). Wall time is 0.4–0.5 s for single sports, ~2.7 s for a cold `ALL` (Kalshi pacing).

## Matching the same game across sources (`matchEvents`)

1. Records are processed ESPN → Polymarket → Kalshi; the first member sets **home/away orientation and the exact start**. A record listing the teams the other way round is mirrored (`flipMarket`: moneyline swap, spread line negated).
2. Same sport **and league** (`EPL` ≠ `UCL`), both teams match, start within **3 h** (exact vs exact) or **5 h** (anything involving a derived Kalshi start); nearest wins. Date-only records (Kalshi college/soccer/UFC) match if the other record's ET or UTC calendar date equals the ticker date.
3. Team names (`teamsMatch`): accents/punctuation stripped, `St.` → *saint* (leading) / *state* (elsewhere), `LA` → *Los Angeles*, noise words dropped (`FC AFC CF SC Club de …`), then **equal, or one is a token prefix/suffix of the other** ("Vegas", "Golden Knights", "Vegas Golden Knights" all match). Kalshi's trailing disambiguation letter (`Los Angeles C`, `New York R`) must match the next word's initial. A small alias list covers PSV/Eindhoven, Köln/Cologne, München/Munich, M'gladbach, LAFC…
4. For NFL/NBA/NHL/MLB/WNBA a name table (`TEAM_NAMES`) resolves city-only / nickname-only names to the full name when unambiguous, so Kalshi ("Detroit") can meet Polymarket ("Red Wings") even when ESPN has no line yet.
5. Id: `${sport}|${YYYY-MM-DD UTC}|${normHome}|${normAway}` from the canonical (longest) names. Because the canonical name depends on which sources responded, treat the id as a session key and re-resolve by teams after a refresh.
6. Finished games (ESPN `post`, or no explicit status and started > 5 h ago) and games with no usable market are dropped. Events with no exact start from anyone carry `startApprox: true`.

## De-vig and consensus (`shared/oddsConsensus.ts`)

- **Books (DraftKings):** American odds → implied probability; the two (three, for soccer) implied probabilities sum to 1.04–1.10; the margin is removed by `devig2` (proportional / multiplicative), the contract's method. `method: 'power'` (solve aᵏ + bᵏ = 1) is available; it gives the favourite slightly *more* than proportional (favourite-longshot bias).
- **Exchanges:** no vig. The two price legs are only **re-normalised** to sum to 1 (Kalshi's team contracts are separate books quoted as bid/ask mids; the spread/total complements are exact). `vigRemoved: false`.
- **Weights:** book = 1. Exchange = liquidity factor × tightness factor, 0.04–1: `clamp(log10(1+volume)/4, 0.15, 1)` (≈ $10k traded = full) × `clamp(1 − width/0.10, 0.2, 1)` (1c wide = 0.9, 5c = 0.5). Unknown volume/width = 0.5/0.6.
- **Consensus** = weighted mean of outcome-0 fair probability; `spread` = max − min across sources. `confidence`: high (≥2 sources, spread ≤ 3 pp), medium (≤ 6 pp), low otherwise / single source. Warnings: spread > 5 pp, wide books (≥ 5c), no volume, single source.
- **Lines:** only identical lines are compared (`SAME_LINE`); `bestLines()` ranks lines by number of sources, then closeness to 50/50; `mainLine()` is its head. Alternate lines are *not* interpolated.

## Known gaps

- **No FanDuel**; DraftKings only, and only about a day before kick-off. ESPN may simply have no line for a game (NBA preseason, many CFB games).
- Exchange coverage today: WNBA (offseason), college basketball (not started), UFC (no card within 3 days; a card on Oct 17 has DraftKings lines on ESPN but no Kalshi/Polymarket markets posted yet). Polymarket has no soccer spread/total on this path; Kalshi soccer spread/total only for EPL and UCL (budget).
- Player props and quarter/half/period markets are intentionally ignored.
- Kalshi start times for pro leagues are estimated; for college/soccer/UFC they are date-only (see timing).
- Soccer moneyline is 3-way (90 minutes). Real's own soccer markets may price it differently (2-way, draw no bet?) — unverified; the draw share is exposed (`Consensus.draw`) so the UI can offer both.
- Polymarket's `endDate` quirk for MLB (+8 days) is empirical.
- Unmatched singles remain for transliteration differences (e.g. "Real Racing Club"); they still appear as one-source events.
- UFC: ESPN header bouts parse correctly (verified on the Oct 17 card); the scoreboard-format UFC branch is untested against live data.
