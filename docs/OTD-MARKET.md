# OTD market side — what cards cost (Tab 7 cost model)

Research pass of 10 Oct 2026. Companion code: `shared/otdPricing.ts` (+ `tests/lib/otd-pricing.test.ts`).
Every claim is tagged **[documented]** (Real's own docs/changelog/store listing), **[community]** (Rax Academy / other players, not Real), **[inferred]** (our deduction, shown with its working) or **[unknown]**.

**Headline:** Real's public docs give the *structure* of card pricing exactly (the rating ladder, pack prices, claim cost) but publish **no marketplace prices, medians, pull rates or fee**. The only live price signal is Rateboard's buyer bids (a Rax-per-rating *rate*). So the model prices a card as `claim cost + required rating × rate`, with the rate an editable estimate. Treat absolute prices as order-of-magnitude until you enter real in-app numbers.

---

## 1. How the card system prices things

### 1.1 Card types and what "rating" is
- Three card families: **Play cards** (a single play/performance with a *rating*), **Player cards** (claimed once per player-season, earn Rax every game and via OTD) and **Team cards**. [documented] docs.realapp.link/collect/play-cards, /player-cards
- **Play-card rating** depends on game situation (closeness, time, streaks, distance, game-winning impact…); no formula or scale is published. A rare trait can rate lower than a common one. Example in the docs: a Jimmy Butler lead-taking midrange play, EPIC, rating 4; a Paolo walk-off, rating 8.7 base (Prestige 1 = 26.1). [documented] /play-cards, /prestige, /real-rating-system
- **Prestige** combines 3 identical cards into one with 3x the rating (P1 3x, P2 9x, P3 27x). So rating can be consolidated; price per rating-point is not obviously changed by it. [documented] /prestige
- **A Player card levels up by accumulating rating**: the ladder is defined by *total rating of the collected play cards for that player + season*, and each rung has a Rax-earning multiplier. [documented] /player-cards

### 1.2 The ladder (total rating → multiplier)
Exact table in `RATING_LADDER` (shared/otdPricing.ts). Selected rungs [documented, "levels are subject to change"]:

| Rung | Total rating | Earn multiplier | OTD annual cap (docs, per card) |
|---|---|---|---|
| General | 0 | 1x | 200 |
| Common | 10 | 2x | 1,000 |
| Uncommon | 30 | 3x | 1,500 |
| Rare | 80 | 4x | 2,000 |
| Epic | 180 | 10x | 5,000 |
| Legendary 1 / 3 / 5 | 380 / 720 / 1,180 | 25x / 32x / 40x | 12,500 / 16,000 / 20,000 |
| Mystic 1 / 6 / 10 | 1,380 / 2,480 / 3,250 | 75x / 95x / 105x | 37,500 / 47,500 / 52,500 |
| Iconic 1 / 5 / 10 / 20 | 3,380 / 5,600 / 10,600 / 40,000 | 150x / 163x / 185x / 250x | unlimited |

Sources: docs.realapp.link/collect/player-cards (ladder), /collect/on-this-day (caps). Dennis's "Iconic = General × 150" matches Iconic 1. [documented + community agree]

### 1.3 Packs [documented unless noted] — docs.realapp.link/collect/card-packs (+ changelog)
| Pack | Contents | Cost | Limit |
|---|---|---|---|
| Starter | 3 plays | 100 | 3/day |
| General ("Gen") | 5 plays + 1 performance | 200 | 5/day |
| Yesterday | 4 plays + 1 performance (yesterday's games) | 200 | 3/day |
| **Player** | **3 plays of one player** | **200+** (changelog Mar 2025: 200–400; Dec 2025: up to 5/day at *increasing prices by the player's season ranking*) | 5 per player/team, 30 per sport/day |
| Team | 3 team plays + 1 performance | 300 (changelog 2025: 200–400) | 2 per team/day |
| Game | 5 plays + 2 performances from one game | 800 rising to 1,250 as 300 packs sell | 1/game |

- Every pack also has a **booster** (single-use, one-day stat boost; contents undescribed). Pro gets a **free daily General pack**. Sept 8 2026: General packs now give 2 top-30 players and an extra play card. [documented]
- **Player pack ~271 Rax "normally"** — [community] (Rax Academy). Consistent with the documented "200+" rising with player rank; the exact formula is [unknown].
- **Odds / pull rates for any rarity: [unknown]** — not published, no community table found. Play-card "rarity" in the docs reflects how often a trait occurs in a season (common → legendary), not the rating.
- "Gen vs team pack" for the *Global method*: General packs pull from the whole season's plays across players; team packs bundle team plays. Dennis says team-pack cards show "insane price jumps" in the Global view. [community]

### 1.4 Claiming a player card [documented]
- Player card **200 Rax**, team card **800 Rax**; one free player card (and discounted team card) per sport each new season; MLB launch post "all player cards are 200 Rax". Past-season cards at Common or better can claim OTD.

### 1.5 Marketplace [documented structure / unknown prices]
- Timeline: Pro auction house (Jun 2025) → Rax offers on plays/performances/serials; an accepted offer starts a **12-hour auction** with the offer as the first bid (Jul 2025) → Marketplace tab, full player-card auctions with a 10-minute target-price timer, **Quick Sell** (Aug 2025) → bulk Quick Sell, cancel listings/offers, marketplace opened to high-karma non-Pro (Sep 2025) → counter offers (May 2026) → Quick Sell/Quick List recommendations in the pack summary (Aug 2026). [documented] changelog
- Docs: any account can bid on listed cards ("hundreds of thousands" of cards quick-sold by others); Pro/very active accounts can list and make offers. [documented] /level-up-cards
- **Fee: 10% on sales** — only evidence is Dennis's arithmetic "410 − 41 = 369". Not in any Real doc, Terms or FAQ. [community]
- **Fair market value:** the client has `/marketplace/fmv/…` (DATA-SOURCES.md), so Real computes an FMV; method [unknown], gated API. **"Owned" vs "Global":** owned = your cards; global = every card of that player pulled from Gen/team packs in the world (Dennis's method) — i.e. the supply you can bid on. [community]

### 1.6 What determines price
- **Rating** (price quoted as rating × rate; Rateboard copy-message `i have <rating> <player> <rating × rate, to nearest 10>`). [documented in Rateboard code, shared/rateboard.ts]
- **Player demand:** Rateboard's rate is per player; buyers pay 8 for most, 15–55 for stars (see §4). [inferred from board]
- **Rarity of the *target* card** → required total rating (documented) → price. **OTD earnings** feed *demand*, not price directly: more earnings per rating point → buyers bid more. [inferred]
- Rarity of the individual play card, owners count, and Real-hype are plausible price drivers; **no source quantifies any of them** [unknown].

---

## 2. Price levels

| Item | Level | Tag | Source / working | Stale? |
|---|---|---|---|---|
| General player card | 200 Rax | documented | docs Player Cards | current Oct 2026 |
| Team card | 800 Rax | documented | docs Team Cards | current |
| Player pack | 200+ (docs), ~271 typical | documented / community | card-packs, changelog, Rax Academy | rank-dependent; check |
| General pack | 200 | documented | card-packs | Sept 2026 contents changed |
| Marketplace fee | 10% | community | "410−41=369" | unverified |
| Rate per rating, floor | 8 | documented (Rateboard code) | Rateboard MIN_TIER | 2026-10-10 |
| Rate per rating, median | 10 | inferred | median of 637 live Rateboard offers 2026-10-10 | live data |
| Rate per rating, p75 / p90 | 15–20 / 25–30 | inferred | same board | live data |
| Rate, stars | 40–100 | inferred | FC/UFC offers (Yamal 50–55, Topuria 100) | live data |
| Rax bundles | 400/$4.99 … 14,000/$49.99 (≈ 280 Rax/$; Pro +10%) | documented | App Store listing (checked 2026-03-21) | mostly current |
| **Median price of cards by rarity** | **none published** | **unknown** | searched Reddit/X/YT/blogs/docs — nothing | — |
| 2025 Ohtani Iconic, 23-24 Luka Iconic cost | **not quoted anywhere found** | unknown | model: 200 + 3,380 × rate ≈ 27k / 34k / 102k at rate 8 / 10 / 30 | — |
| "Payback days" folk wisdom | **no quote found** | unknown | — | — |

**Model-implied ladder prices** (rate 10; General annual earnings 715 = Ohtani 2025; ignores caps) [inferred]:

| Rung | Price @10 (band 8–30) | Annual (General×mult) | Payback |
|---|---|---|---|
| Common | 300 (280–500) | 1,430 | 77 d |
| Rare | 1,000 (840–2,600) | 2,860 | 128 d |
| Epic | 2,000 (1,640–5,600) | 7,150 (cap 5,000) | 102 d (146 d capped) |
| Legendary 1 | 4,000 (3,240–11,600) | 17,875 (cap 12,500) | 82 d (117 d capped) |
| Mystic 1 | 14,000 (11,240–41,600) | 53,625 (cap 37,500) | 95 d (136 d capped) |
| Iconic 1 | 34,000 (27,240–101,600) | 107,250 | 116 d |
| Iconic 10 | 106,200 | 132,275 | 293 d |
| Iconic 20 | 400,200 | 178,750 | 817 d |

Takeaway: **Rax earned per Rax invested peaks at Legendary 1 / Epic / Mystic 1 / Iconic 1 and falls steeply above Iconic ~5**, because the ladder demands ever more rating per extra multiplier point. Because the claim limit is 2 per sport per day (3 with Pro) [documented], the binding constraint is *claim slots*, so the efficiency ranking should be "earnings per claim slot" first, "per Rax" second. [inferred]

---

## 3. Swaps (Rax Academy, normally Pro-only) [community]

Mechanics: "200 in the hole" means you each buy a Player pack for a different player. Each sends the other the lowest possible offer (≈410–420; consistent with min rate 8 × ~51 rating across 3 cards [inferred]) on the pack's cards, so each of you is down pack + offer, then each receives the other's offer back minus 10%.

**Pack swap (verified arithmetic)**
`net = pack + offerSent − offerReceived × (1 − fee)`; symmetric offers O: `net = pack + fee × O`.
200 + 410 = 610 down → 410 − 41 = 369 back → **610 − 369 = 241**. You pay ~241 per pack and keep the booster and the cards of your pack's player (partner's offer is paid for the cards you pulled; ownership detail is [unknown]). With a normal 271 pack, the swap saves ~30 only if the 200 pack price applies to you (Pro / rank-dependent price) — [inferred].

**"160 back"**: you buy a pack (271 normally) for the player the other person is grinding; they offer high on the 3 cards you pulled, and because min-min offers are so high they "give you 160 rax back". The post's own wording ("you gain some rax") is ambiguous: modelled as `net = pack − cashBack − offer × (1 − fee)`, i.e. 271 − 160 = **111 net cost**, minus any offer you also keep. How the 160 decomposes (offer vs. top-up, and whether it's pre/post fee) is [unknown] — verify before trusting. `grossForNet(net, fee)` converts a wanted net into a gross offer.

**Other mechanics**: the Global method (Cards → sport → player → OTD year → plays/performances → search → switch Owned→Global; offer on 100 cheapest; skip team-pack cards) is a *price-discovery* tactic, not a price. [community]

---

## 4. What Rateboard's public board exposes (fetched once, 2026-10-10)

`GET /api/kv?key=ratebrd_market_v1`: 1,576 users, **637 live buy offers**, 113 floors ("minimums"), 623 keep-list rows, 30 house-list rows, 4 `fullprice` rows (rax/owners records, not prices), 92 private reports (stripped by our proxy).

- Offer fields: `{id,user,sport,player,rate,link,ts}` — **no card rating, no card id, no season, no rarity**. Sports: FC 252, NFL 169, CFB 125, UFC 67, NHL 24 — **no NBA, MLB, CBB, golf**. Offers dated 15 Sep–10 Oct 2026 (current-season cards only).
- Rate distribution: median 10; 8 (floor) 29%, 10 26%, 15 16%, 20 14%, 25+ ~13%; max 100 (UFC). Per sport p90: NFL 25, CFB 25, FC 30, UFC 50.
- Floors (113): 15 (66), 20 (28), 25 (15) — all CFB/FC. House list (30, all NFL): 27 at rate 8.
- Only 474 players have any offer; 32 have ≥3 buyers.

**Can we derive per-player prices?** Partly. `price ≈ card rating × rate` needs a rating we don't get from the board (`/api/collection` supplies `totalValue` for a *user's own* cards). Limits [inferred]:
1. Rate is a **buyer bid** per rating point on *current-season play cards*, not an observed sale and not a historical (OTD-year) card price.
2. Floors/house rates dominate: most players sit at 8–10, so the board mostly tells us "no premium", not a price.
3. No coverage of NBA/MLB — the sports with the best OTD earners (Ohtani, Luka, SGA).
4. Thin: only 32 of 474 players have 3+ bidders; most have a single bid.
So the board is usable as (a) a global default rate band (8 / 10 / 30) and (b) a *relative demand* hint for the sports it covers (`rateBand` can take a per-sport multiplier). Don't present it as a per-card price.

---

## 5. How the efficiency model should price a card

1. **Pick the target rung** (`RarityLevel.key`; `rungFor` maps 'Iconic' → Iconic 1, 'Legendary' → Legendary 1).
2. **Price = claim cost (200) + total rating × rate** — claim and rating are documented; the rate is the estimate (default 10, band 8–30, sport/owners multipliers off by default).
3. **Override order:** your per-card price (`overrides[id]`, keyed `${sport}|${season}|${playerId}`) → your rarity anchor (`rarityAnchors`, e.g. "Iconic median 45k" once you've looked) → ladder model. A `pricePerAnnualRax` (payback years) anchor enables the `payback`/`blend` methods.
4. **Always show the band and the `basis` line**, badge `inferred`, never "documented", for ladder prices. Use `estimateUpgradeCost` for already-owned cards (price only the missing rating).
5. **Efficiency** = `annual × multiplier` (capped per `capFor`) ÷ price, per claim slot; also show payback days. Don't charge a fee on buying; apply the 10% (`afterFee`) only to resale/exit value.
6. **Packs** are a cheaper acquisition of rating only if play-card pull ratings are known: `packEconomics` returns null until you enter an average rating from your own pulls. Swaps (`swapCost`) reduce the *effective* pack price from 271 toward ~241 (or lower with "160 back").
7. **Sanity check** the output against the folk-wisdom you meet: model Iconic-1 payback ≈ 116 days for a 715-General card.

## 6. Open questions (what we could not establish)
1. Real marketplace median/typical prices per rarity (none published) — user should record 3–5 in-app sales per rung into `rarityAnchors`.
2. Does the cost of **rating** scale linearly? High-rating plays may cost more per point and supply is finite; 3,380 rating at the floor rate assumes unlimited cheap supply. Likely convex → the model's Iconic prices are probably a **lower** bound.
3. Do **historical-season** play cards (what OTD cards need) trade at the same rate as current-season ones? Rateboard only shows current.
4. Is the **10% fee** exact, and who pays it (seller only)? Is there a fee on offers/auctions?
5. Pack **pull-rate/rating distribution** and what a booster is worth; how the Player-pack price depends on the player's rank.
6. The exact decomposition of "160 back"; and whether a swap's received cards are the ones you pulled or your partner's.
7. **Conflicts to resolve in `shared/otdRules.ts`** (owned elsewhere): (a) Real's docs give the full multiplier ladder above — `multiplier` is still `unknown` for every rung but Iconic; (b) docs list General cap 200 (the file says 0) and Mystic 8 cap 50,000 (file: 50,500); (c) OTD docs' worked example uses Rare = 1.6x while the earnings table says 4x — whether OTD uses the earnings multiplier or a separate one is unconfirmed; Dennis's Iconic 150x agrees with the earnings table; (d) Real's Aug-2025 X post announced Rax caps removal and a different multiplier set (Iconic 40x) that the later docs supersede — treat caps as possibly stale.
8. Whether card *rating* in Rateboard's `i have <rating> …` is a player's total or a single play card's (collection `totalValue` suggests a player's total of the cards the seller holds).

## 7. Sources
- Real docs (fetched 10 Oct 2026): docs.realapp.link/collect/player-cards, /on-this-day, /card-packs, /play-cards, /play-cards/prestige, /level-up-cards, /start, /team-cards, /basics/real-pro, /basics/faqs, /basics/rax, /updates/changelog, /policies/terms-of-use (no fee or marketplace terms).
- App Store listing + App Pricing Lab (Rax bundles, Pro prices, checked 2026-03-21): apps.apple.com/us/app/real-sports/id1514546162, apppricinglab.com/iap/apple/1514546162.
- Real on X, Aug 2025 (caps/multipliers announcement; via search snippet only — X returned 402): x.com/realapp/status/1957584310304690382.
- Rax Academy by Dennis (transcribed posts: top OTD lists, caps, swap and 160-back screenshots).
- Rateboard public board, one request 2026-10-10; Rateboard source logic in `shared/rateboard.ts`.
- Searched without result: Reddit, YouTube transcripts, blogs for marketplace medians, "payback", fee, pull rates (public web has essentially no coverage of Real's card economy).
