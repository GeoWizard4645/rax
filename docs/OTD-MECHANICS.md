# OTD (On This Day) mechanics — what is established, and how sure we are

Research snapshot: **2026-10-10**. Machine-readable version: [`shared/otdRules.ts`](../shared/otdRules.ts).

Tags: **[documented]** = Real's own docs / changelog / official X posts · **[community]** = Rax Academy (Dennis) or other players, not Real · **[inferred]** = our deduction (reasoning shown) · **[unknown]** = not established.

## Sources and how much to trust them

| Source | Trust | Notes |
|---|---|---|
| `docs.realapp.link` (Real's GitBook; append `.md` for raw text) — pages: [On this day](https://docs.realapp.link/collect/on-this-day), [Player cards](https://docs.realapp.link/collect/player-cards), [Team cards](https://docs.realapp.link/collect/team-cards), [Card packs](https://docs.realapp.link/collect/card-packs), [Real Pro](https://docs.realapp.link/basics/real-pro), [Arena](https://docs.realapp.link/interact/arena), [Changelog](https://docs.realapp.link/updates/changelog) | **High**, but the pages drift out of date (see "docs bugs" below) and the OTD page's example still uses the 2023 multiplier (1.6× Rare) | Primary source for almost everything below |
| Real's X posts, [@realapp_ 2025-03-26](https://x.com/realapp_/status/1905039521995178152) and [@realapp 2025-08-18](https://x.com/realapp/status/1957584310304690382) (read via the public fxtwitter mirror) | High (official) | Aug-2025 multipliers are superseded by Dec 2025 |
| Wayback Machine snapshots of the docs (2025-03 … 2026-06) | High for history | Used to date the CBB/CFB/MLB/WNBA factor changes and the cap-table change |
| Rax Academy posts by Dennis (OCR transcripts in this repo's scratchpad; `shared/otdReference.ts`) | Medium-high: his numbers reconcile exactly with Real's docs (caps, 150× Iconic, buffs) | Not independently published on the open web |
| Change.org petition ("Remove the Rax Cap", 2025) | Low | Only used to understand the *origin* of per-card caps (200-Rax cap on MLB 2025 cards = card price) |
| Reddit / YouTube / Discord | **Not reachable.** Reddit's JSON blocks anonymous clients; the web-search tool surfaced no useful threads. Nothing here relies on them. | |

**Docs bugs to be aware of** (we trust the data over the labels): (1) the Player-cards page still labels Mystic 1 as "Additional 1000 rating (1,380 total)" and Iconic 1 as "Additional 2000 (3,380 total)"; the **totals** chain correctly (Legendary 5 = 1,180 → Mystic 1 = 1,380 is +200; Mystic 10 = 3,250 → Iconic 1 = 3,380 is +130) and the March-2026 archive says exactly "+200" and "+130". (2) The Team-cards page still lists 1.2×…6× team multipliers, apparently not updated since the player ladder changed. (3) The OTD page says nothing about sport factors or buffs — those live on the Player-cards page.

## 1. How a claim is calculated

- **[documented]** You claim Rax from *previous-season* player/team (and UFC fighter) passes. The amount depends on "how much the player or team earned on the same day in history" — i.e. the anniversary of a game. Card must be **Common or better** (a General card cannot claim). [On this day]
- **[documented]** Payout for one claim = *that day's General-level (base) Rax* × *the card's rarity multiplier*. Real's own example: Rare Steph Curry 2022-23, Nov 15 2022 he earned 18 → claim 29 on Nov 15 2023 (18 × 1.6 = 28.8). That example is from the 2023 ladder (Rare = 1.6×); the principle is unchanged, today Rare = 4×.
- **[documented]** Base per-game Rax = Real rating × a sport factor (below); playoffs / majors are 2×. Players with a negative rating earn nothing that game. Live cards are paid next morning 7am ET.
- **[community]** A card's "Earnings at General" for a season is Σ(per-game base Rax over every game that season); each game pays on its own anniversary. "Iconic earnings" in Dennis's lists = General × 150, which matches the documented Iconic 1 multiplier exactly.
- **[inferred]** The multiplier OTD uses is the same multiplier as the live per-game one (docs show one ladder; Dennis's 150× agrees).
- **[unknown]** Per-claim rounding (the 28.8 → 29 example fits round-nearest *and* ceil). Constants use `Math.round`; error is ≤0.5 Rax/claim, negligible.
- **[inferred]** The sport-factor buffs apply **retroactively** to OTD of past seasons: Dennis's CBB list shows Edey 23-24 as 708 (post-buff) vs 565 earlier, ratio 1.253 ≈ 2.5/2; Jeanty 537 → 669 (×1.246 ≈ 5/4). So OTD re-prices history at the *current* factor. (Check Rateboard's `/api/rax` rows against these — Q6.)

### Sport factors (rating → base Rax) — [documented]

| Sport | Now (Oct 2026) | Before | Changed |
|---|---|---|---|
| NFL | off 5×, def 7× | same | — |
| CFB | off **5×**, def **8×** | off 4×, def 7× | between 2026-06-17 and now (Dennis: July 2026) — offense ×1.25, defense ×1.143 |
| CBB | **2.5×** | 2× | same window (×1.25) |
| NBA | 1× | same | — |
| WNBA | 2× | 3× (Dec 2025) | nerf, before 2026-06-17 |
| NHL | 1.2× | same | — |
| MLB | batter 2×, SP 3×, RP 5× | 1.5× / 2× / 4× (Dec 2025) | buff before 2026-06-17 |
| Golf | 3× | — | new sport 2026 |
| FC (soccer) | 3.5× | — | — |

Playoffs/majors ×2 (so CBB playoffs 5×, CFB offense playoffs 10× / defense 16× — exactly Dennis's "×4→×5, ×8/×14→×10/×16"). The July-2026 buff is **not in Real's changelog** (which has no July 2026 entry), but is confirmed by the before/after docs snapshots and Dennis's numbers. Source: [Player cards](https://docs.realapp.link/collect/player-cards) now vs archived 2026-06-17 (`web.archive.org/web/20260617224614/…/collect/player-cards`).

## 2. The rarity ladder: multiplier, cap, rating needed

All **[documented]** ([Player cards](https://docs.realapp.link/collect/player-cards) multiplier table + per-level "OTD Cap"; [On this day](https://docs.realapp.link/collect/on-this-day) cap table). "Rating" = cumulative summed rating of the Play + Performance cards you own for that player-season (negative plays count by absolute value).

| Rung | Mult. | OTD cap (player) | Rating to hold it | | Rung | Mult. | OTD cap | Rating |
|---|---|---|---|---|---|---|---|---|
| General | 1× | n/a (200 listed; can't claim) | 0 | | Mystic 1 | 75× | 37,500 | 1,380 |
| Common | 2× | 1,000 | 10 | | Mystic 2 | 79× | 39,500 | 1,560 |
| Uncommon | 3× | 1,500 | 30 | | Mystic 3 | 83× | 41,500 | 1,760 |
| Rare | 4× | 2,000 | 80 | | Mystic 4 | 87× | 43,500 | 1,980 |
| Epic | 10× | 5,000 | 180 | | Mystic 5 | 91× | 45,500 | 2,220 |
| Legendary 1 | 25× | 12,500 | 380 | | Mystic 6 | 95× | 47,500 | 2,480 |
| Legendary 2 | 28× | 14,000 | 520 | | Mystic 7 | 98× | 49,000 | 2,760 |
| Legendary 3 | 32× | 16,000 | 720 | | Mystic 8 | 101× | **50,000** | 3,000 |
| Legendary 4 | 35× | 17,500 | 1,000 | | Mystic 9 | 103× | 51,500 | 3,180 |
| Legendary 5 | 40× | 20,000 | 1,180 | | Mystic 10 | 105× | 52,500 | 3,250 |
| | | | | | **Iconic 1** | **150×** | **unlimited** | **3,380** |

Iconic 2–20 (all uncapped, **[documented]**): 153×, 156×, 159×, 163×, 167×, 171×, 175×, 180×, 185×, 190×, 196×, 202×, 208×, 214×, 220×, 226×, 233×, 240×, **250×** at cumulative rating 3,800, 4,300, 4,900, 5,600, 6,400, 7,300, 8,300, 9,400, 10,600, 12,000, 13,600, 15,400, 17,500, 19,900, 22,700, 26,000, 29,000, 34,500, 40,000. **Dennis's lists use Iconic 1 (150×) only; an Iconic 20 card pays 250/150 = 1.67× his figure.**

Other findings on the ladder:

- **[inferred, very strong] Cap = 500 × multiplier.** Common 1,000 = 2×500; Uncommon 1,500 = 3×500; Rare 2,000 = 4×500; Epic 5,000 = 10×500; Legendary 1–5 = 25/28/32/35/40 × 500 = 12,500 … 20,000; Mystic 1–10 = 75 … 105 × 500 = 37,500 … 52,500 — **18 of 19 rungs match exactly**. The only miss is Mystic 8 (101 × 500 = 50,500; Real's page says 50,000 — treat 50,000 as authoritative). General (200 = 1×200) is a different rule. Consequence: *a cap bites as soon as a card's General-level season total exceeds ≈500* (cap ÷ multiplier = 500 at nearly every rung). Every card on Dennis's top-10 lists (General 476–715) is therefore capped at every rung below Iconic, and **cards with General < 500 are never capped at any rung**.
- The cap table was previously very different (until at least 2026-02; archived): Common 500, Uncommon 1,000, Rare 2,200, Epic 4,500, Legendary 9,000, Mystic 18,000 (multipliers then 2/3/4/6/10/20×). The Dec-2025 "Epic and above" multiplier raise (6→10, 10→25, 20→75, 40→150 for Epic/Leg/Mystic/Iconic) came with the big cap rise. Real changes this table; version it.
- **UFC fighters** [documented] have their own cap table (General 800, Common 1,500, Uncommon 3,000, Rare 6,000, Epic 12,000, Legendary 24,000→30,000 in +1,500 steps, Mystic 48,000→64,000 in +2,000 steps, Mystic 10 67,000, Iconic unlimited). The fighter multipliers are **[unknown]** (the cap table does not follow cap = 500 × player multiplier). **Team** caps: General 800, Common 1,500, Uncommon 2,500, Rare 4,000, Epic 6,000, Legendary 12,000, Mystic 24,000 (no sub-levels listed); team multipliers on the team page are 1.2/1.4/1.6/2/2.5/4/6× (probably stale). Dennis's "900th golfer beats the 100th UFC fighter at Iconic" is a [community] profit-ranking opinion.

## 3. Cap semantics: per card, per year, per season?

- **[documented]** "The total amount of Rax that a card can earn depends on the rarity level of your card." Real says *total*, not *per year*. The cap's origin is the live in-season earning cap (MLB-2025 launch: "all players start with a cap of 200 Rax", = card price; [@realapp_ 2025-03-26](https://x.com/realapp_/status/1905039521995178152): "Player and team cards will follow the 'On This Day' caps during the active season"; serial-tier Rax is separate from the cap).
- **[inferred]** The cap is **per card (one player-season) and applies to the OTD sum for one year**. Reason: the cap/multiplier ≈ 500 design only makes sense against a season's full-year total (top seasons ≈ 450–715 General), and Dennis's whole framework ("full list of claims for the entire year", yearly totals per card, "a consistent flow of Rax you can plan around") treats OTD as a repeating annual income. **But Real never states the reset.** If the cap were lifetime, a Mystic-10 card would stop paying after about one year, which no community post suggests. Constants carry `capPeriod: 'per-year'` with confidence **unknown** (a working assumption). This is the single most valuable thing to verify (Q1).
- **[unknown]** Whether Rax earned live during the season (before it became "historical") counts against the same cap.

## 4. Claims per day, Pro, windows

- **[documented]** **2 guaranteed claims per sport per day**, free or Pro (so the limit is per sport, not global). "Select the cards you want to claim for each sport" via the Cards tab → calendar button (OTD Calendar added June 2026). One claim = one card-day. Since 2024-03-15 the 2 may be any mix of players/teams (before that: one player *or* one team).
- **[documented]** **Pro** adds *"a chance at 1 additional claim across all sports each day"*: you place a pass on a pick-the-winner poll in the game feed (pass icon 🎫 under polls); **win the poll → bonus Rax for that card; lose → nothing**. Added 2024-08-15. So Pro ≠ "3 per sport": it is **+1 per day total, conditional**. Dennis's "3rd claim" and "triple overlaps only hurt non-Pro, who have only 2 a day… you still have a chance at the third with Pro" are consistent with this. The win probability is **[unknown]** (depends on the poll; a model should expose it as a parameter, e.g. 50% as a clearly-labelled placeholder).
- **[unknown]** Claim window / carry-over. Docs are silent. The calendar can show *future* days to view (changelog 2023-12-15). Safest assumption: a claim is for the anniversary day and unused claims are lost (the 2/day are "daily" allowances). The Real docs do not say you can back-claim.
- **[inferred]** A day with 3 of your cards in one sport = you claim the best 2 and forfeit the third's Rax ("triple overlap"). Overlap days are computable from game dates; no need to rely on weekday folklore.

### Weekday-alignment lore (NFL/CFB/golf "2 per year")

- **Golf [inferred, verified]**: Dennis groups seasons into year sets {2015, 2020, 2026}, {2025, 2014}, {2024, 2019}, {2018}, {2023, 2017}, {2022, 2016}, {2021}. I verified these are exactly the groups of years with identical weekday calendars for Mar–Dec (e.g. June 1 falls on the same weekday). Tournaments run Thu–Sun, so golfers' rounds from years in the same set land on the *same calendar dates* (heavy overlaps); picking the best 2 golfers per set, from different sets, minimises overlaps.
- **NFL/CFB [inferred, imprecise]**: games sit on Sundays/Saturdays, and a calendar date's weekday moves by one each year, so seasons one year apart have game dates offset by one day — two seasons of the same sport tend not to collide, giving you "2 per year" without overlaps. This is a heuristic; the app should compute collisions from actual game dates.

## 5. Boosts

- **[documented]** A booster card (one per pack; five rarities Rare→Iconic, see the Player-cards page) is applied to a player card before a game and lasts that day. Since 2023-12-23 boosters give *flat extra Rax per listed stat* (e.g. NBA Legendary 3-pointer booster = 20 Rax per three; Rare = 12) on top of the card's multiplier; @realapp 2025-08-18: "Booster cards add, not multiply". Unused boosters carry over to next season of that sport. (Before Aug 2025 they multiplied: 2023 FAQ example Rare 1.6× card + Epic 2× booster = 3.2×.)
- **[unknown → inferred NO]** Nothing in docs or community says boosters change an **OTD claim**; the documented OTD formula is historical base Rax × rarity multiplier, and Dennis's "Earnings at General" are plain sums. Dennis's "Boosts"/"NHL Boosts"/"CFB Saturday boosts" albums are daily recommendations for *live* games (which stat-booster to apply to which player), not OTD tools. The OTD model should ignore boosts.
- Not to confuse with **Arena Boost** (below): a different mechanic.

## 6. Upgrading cards: there is no upgrade fee

- **[documented]** A player card is *claimed* for 200 Rax (team 800; past-season cards purchasable since 2023-10-26). It **levels up automatically** as the summed rating of Play + Performance cards you own for that player-season grows (thresholds in §2). Play cards come from packs (Starter 100 Rax = 3 plays; General 200 = 5 plays + 1 performance + booster; Yesterday 200; Player pack 200+ = 3 plays of one player; Team 300; Game 800–1,250) or the marketplace/auctions. **Prestige** combines 3 identical cards into one with 3× the rating (Prestige 2 = 9×, 3 = 27×) — rating-neutral for levelling (three cards' worth in one card) but it consolidates duplicates and pays Rax.
- **Iconic is reachable by levelling** (3,380 rating; no special pull needed). **[unknown]**: the Rax cost, since it equals (rating points needed) × (your price per rating point), and neither pack rating distributions nor per-rating market prices are public. Star players' plays are rated higher and cost more; Real's tip: "less popular players are easier/cheaper to level".
- Marginal OTD per rung (derived): the cap makes mid rungs nearly worthless for top cards, and **the single biggest step is Mystic 10 → Iconic 1: only +130 rating for a card with General 627 going 52,500 → 94,050 (+41,550/yr)**; per rating point later: Iconic 1→2 (+420 rating) adds 3 × 627 = +1,881/yr (≈4.5 Rax/yr per rating point), Iconic 19→20 (+5,500) adds 10 × 627 = 6,270 (≈1.1 per point). Early rungs: Common costs 10 rating for +1,000 (capped). Rating-per-Rax prices are the missing input.

## 7. Season rollover / eligibility

- **[documented]** OTD pays only for *previous seasons*; the active season's cards earn live per game ("Claim the active season's player/team cards to earn Rax throughout the active season"; FAQ). Cards of old seasons are kept forever.
- **[inferred]** So the in-progress 2026 NFL/CFB season (and 2026 MLB postseason) is **not** OTD-claimable yet; its cards earn live. A season becomes "historical" when Real rolls the sport to the next season (new-season card launch), which happens around the start of the next regular season — exact switch date per sport **[unknown]**. Dennis's lists already include "25-26" NBA/NHL/NFL and 2025 MLB/golf seasons, consistent with this.
- Date alignment: a game's OTD date is its calendar date one year (or more) later. Seasons that straddle new year (NBA/NHL/NFL/CBB/CFB) pay across two calendar years' worth of dates.

## 8. Arena (new head-to-head mode)

**[documented]** ([Arena](https://docs.realapp.link/interact/arena), "Rules as of October 9, 2026"): five players, salary cap 35, 30-point ability budget, 7-day matchup window, optional Rax stakes (winner takes pot minus 10%). Score = best single-game Real rating × **Arena Boost** + ability payouts. Arena Boost rises with the rarity of your *pass* (first reaching: Common +1%, Uncommon +3%, Rare +9%, Epic +18%, Legendary +32%, Mystic +56%, Iconic +60%, small gains thereafter). **It does not affect OTD earnings.** Dennis says "Pro and Web only"; the docs do not state that. It is a second reason to level cards, but with Rax stakes it is outside an OTD-efficiency model.

## 9. Worked example — Luka Dončić 23-24 (NBA)

Dennis: General 627, Iconic 150 × 627 = **94,050** [community, matches documented 150×]. Payout = min(cap, multiplier × 627):

| Rung | Mult × 627 | Cap | **Annual OTD** | Rating needed |
|---|---|---|---|---|
| Common | 1,254 | 1,000 | **1,000** | 10 |
| Rare | 2,508 | 2,000 | **2,000** | 80 |
| Epic | 6,270 | 5,000 | **5,000** | 180 |
| Legendary 5 | 25,080 | 20,000 | **20,000** | 1,180 |
| Mystic 1 | 47,025 | 37,500 | **37,500** | 1,380 |
| **Mystic 10** | 65,835 | 52,500 | **52,500** (capped; 20% of its raw value wasted) | 3,250 |
| **Iconic 1** | 94,050 | — | **94,050** | 3,380 |
| Iconic 10 | 115,995 | — | **115,995** | 10,600 |
| Iconic 20 | 156,750 | — | **156,750** | 40,000 |

Contrast a General-250 card: Rare 1,000, Epic 2,500, Mystic 10 26,250, Iconic 37,500 — no cap ever binds. Practical rule: *a card with General ≥ ~500 is pointless to level partway through Legendary/Mystic for OTD alone, because the cap flat-lines (52,500 at Mystic 10) while Iconic 1 sits just 130 rating above Mystic 10.* (Mystic 10 itself needs 3,250.)

## Open questions and 2-minute in-app checks

| # | Question | Why it matters | How to check in the app |
|---|---|---|---|
| Q1 | Is the per-card cap per year, or a lifetime total? Does live in-season Rax count against it? | Decides whether capped (non-Iconic) cards are worth anything after year 1 | Open a past-season card at Common/Uncommon: the per-pass **Earnings** button (added June 2026) shows per-rarity totals — compare the season total to the cap; claim one OTD day and see if a "x / cap" progress shows. Look at the same card in January for a reset. |
| Q2 | Rounding of one claim (28.8 → 29: round or ceil)? | ≤0.5 Rax/claim, negligible | Only multipliers 28/79/… on odd bases can't produce fractions (all current multipliers are integers and base Rax per game is displayed as an integer), so this likely no longer matters; skip unless the per-game base is fractional. |
| Q3 | Claim window: can you claim yesterday's/older anniversaries? Do missed days carry? | If back-claiming is allowed, the 2/day limit is much looser | In the OTD calendar tap yesterday and a past date: is "Claim" enabled? |
| Q4 | Does a booster on a past-season card change the claim? | Would add an OTD lever | Check whether the OTD claim sheet offers "apply booster". (No evidence it does.) |
| Q5 | Pro-bonus poll win rate and whether a lost poll still uses the bonus slot | Value of Pro's 3rd claim | Count over a week; docs say lose = no Rax. |
| Q6 | Do Rateboard `/api/rax` per-game values use the *current* factors (post-buff CBB 2.5×, CFB 5/8×, MLB 2/3/5×, WNBA 2×)? | OTD model correctness for those sports | Compare a card's Rax-feed season total with the app's Earnings button / Dennis's lists (e.g. Edey 23-24 = 708, Jeanty 24-25 = 669). |
| Q7 | Fighter (UFC) rarity multipliers | UFC OTD ranking | Earnings button on a fighter pass at two rarities. |
| Q8 | Exact date each sport's season flips to "historical" | Which seasons are claimable now | Cards tab → past-season list for each sport. |
| Q9 | Do Iconic 2–20 caps remain unlimited ("subject to change")? | Large — Real may add an Iconic cap | Re-read the OTD page monthly. |

## Changelog of what changed in the ladder (for versioning)

2023-06-28 six rarities 1×–2.5× (Common 1.2, Uncommon 1.4, Rare 1.6, Epic 2, Legendary 2.5) → 2023-10-26 OTD launched → 2024-03-15 2 claims/day → 2024-08-15 Pro bonus → 2025-08-18 Common 2, Unc 3, Rare 4, Epic 6, Legendary 10, Mystic 20, Iconic 40 (caps: 500/1,000/2,200/4,500/9,000/18,000) → 2025-12-20 Epic 10, Legendary 25–40, Mystic 75–105, Iconic 150–250 with Legendary/Mystic/Iconic sub-levels and today's caps → June 2026 OTD Calendar, per-rarity Earnings button, MLB/WNBA factor changes → mid-2026 CBB 2→2.5, CFB 4/7→5/8.
