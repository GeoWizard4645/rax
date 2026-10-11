# Observed OTD dataset (`public/data/otd-observed.json`)

Real's **own** per-game Rax for the top cards of every sport, as a static snapshot the OTD Efficiency tab loads instantly.
Shape: `OtdSnapshot` in `shared/otdSnapshot.ts` (`method: 'observed'`). Source: Rateboard's `/api/rax` (used with the
owner's permission - see `docs/DATA-SOURCES.md`). `rax` on a day is the **General-level** payout of that game; a card's
real payout = rax x rarity multiplier (Iconic = 150).

Size: ~2.9 MB raw, ~0.58 MB gzipped, 6,355 cards, ~159k claimable days.

## How it is built

`node scripts/build-otd-snapshot.mjs` (plain Node >= 20, no dependencies). Options: `--cache DIR` (default
`$TMPDIR/rax-otd-rateboard-cache`), `--min 3`, `--top 400`, `--no-verify`, `--out FILE`, `--today YYYY-MM-DD`.

1. `gamelog=seasons` lists every collected sport-season.
2. A season is **included** when its nominal end date is before today; in-progress seasons are excluded (see
   `nominalEnd()` / `POLICY` in the script). Judgement calls: MLB 2026, golf 2026 and WNBA 2026 are **included** (regular
   season / major events are final; only October playoff days or fall events are still being added) and flagged in
   `coverage[].note`.
3. `mode=players&sort=rax&dir=desc` page 1 (500 rows) per included season -> per player-season `annual` (= sum of game rax
   = "Earnings at General"), `games`, `best`, `owners`. The top **400 player-seasons per sport** (across its included
   seasons) are selected.
4. `mode=games&sort=rax&dir=desc` is paged (500 rows/request) per sport-season **until rax < minDayRax**. Everything with
   rax >= minDayRax is kept in memory for that sport.
5. Per sport, the **top-4 games on each calendar day (MM-DD) across all seasons** are found; any player-season owning one
   is added to the selection (these supply claims on days nobody in the top 400 has - needed for portfolio optimisation).
   Their `annual`/`games`/`best`/`owners` come from further `players` pages (fetched only while a needed card is missing).
6. Each selected card gets `days = [mmdd, rax, flags]` for its games with rax >= minDayRax, sorted by mmdd.
   Flags: 0 regular season, 1 postseason, 2 other (all-star, WBC / Four Nations tagged "allstar", exhibition, ...).
   `team` is the card's most common regular-season team (the players endpoint reports the *last* game's team, which is
   an all-star squad such as "LEB" for many NBA/NHL stars).
7. Integrity check (on by default): the #1 card of each sport is re-fetched with `q=<name>` and its game rows are summed;
   `sum(rax >= min)` must equal `sum(days)` (it does for all 9 - paging by `sort=rax` loses/duplicates nothing).

Politeness: <= 3 requests in flight, >= 150 ms between request starts, honest UA
(`rax-super-suite/0.1 (+https://rax.vivaanshahani.com)`), no `Accept-Encoding`, every raw response cached on disk, so
re-running with the same cache makes **zero** requests. A full cold build is ~1,300 requests / ~10 minutes (a handful of
HTTP 500s on deep CFB pages are retried with back-off and succeed). To refresh: delete the cache directory (or point
`--cache` somewhere new) and re-run; then run `npx vitest run tests/lib/otd-snapshot.test.ts`.

### Why `minDayRax = 3`
Of the ~48k NBA rows in a season only ~8.7k have rax >= 3 (~15k >= 2, ~4.6k >= 4, ~2.3k >= 5), and the dropped games are
worth <= 2 General rax each (<= 300 Iconic Rax) - never a competitive claim (top claims are 15-100+). Dropping them cuts the
number of `games` pages by ~60 % versus min = 1 and keeps the file < 3 MB. `annual` still includes the dropped games, so
`annual - sum(days)` is the "dust" total (e.g. Ohtani 2025: 715 vs 642 from 79 days).

## Coverage

Seasons are Rax labels (NFL/NHL/CFB = starting year, NBA/CBB = ending year, MLB/PGA/WNBA/SOC = calendar year).

| Sport | Seasons included | Cards | Notes |
|---|---|---|---|
| NFL | 2023-2025 (23-24 .. 25-26) | 575 | 2026 (26-27) excluded - in progress |
| NBA | 2023-2026 (22-23 .. 25-26) | 507 | complete |
| MLB | 2022-2026 | 840 | 2026 through 2026-10-08, postseason still running |
| NHL | 2023-2025 (23-24 .. 25-26) | 620 | 2026 (26-27) excluded; **no 22-23** (not collected) |
| CBB | 2024-2026 (23-24 .. 25-26) | 778 | 23-24 has ~33 % fewer rows than later seasons |
| CFB | 2023-2025 (23-24 .. 25-26) | 766 | 2026 (26-27) excluded - in progress |
| PGA | 2014-2026 | 1,008 | 2026 through 2026-10-04 (fall events still to come) |
| WNBA | 2024-2026 | 402 | 2026 through 2026-10-09 (finals running); only 154-238 players/season so ~all are in |
| SOC | 2025 only | 859 | one season; spans 2025-08-15 .. 2026-09-27 (see gaps); 2026 excluded - in progress |
| UFC | - | - | no per-game source |

Selection: top 400 player-seasons by annual rax + the extra cards owning a top-4 game on some calendar day (NFL +175,
NBA +107, MLB +440, NHL +220, CBB +378, CFB +366, PGA +608, SOC +459, WNBA +2). Annual-rax cut-offs for the top 400:
NFL 195, NBA 188, MLB 315, NHL 226, CBB 309, CFB 290, PGA 314, SOC 278.

## Validation against `REFERENCE_CARDS` (65 cards)

Match = same sport, season label (via `seasonLabelFor`), diacritic/suffix-insensitive name. `Rateboard annual` is the
`annual` field; delta = ours - guide.

| Sport | Matched | Exact | Notes |
|---|---|---|---|
| NFL | 7/7 | 7 | all exact |
| CBB | 10/10 | 10 | all exact - **including post-buff figures (Edey 708)** |
| CFB | 10/10 | 10 | all exact - **including post-buff figures (Jeanty 669, Skattebo 616)** |
| NBA | 10/10 | 7 | SGA 24-25 613 vs 617 (-4), Jokic 24-25 559 vs 560 (-1), Wembanyama 25-26 480 vs 488 (-8) |
| NHL | 8/10 | 4 | McDavid 23-24 610 vs 626 (-16), Draisaitl 23-24 570 vs 590 (-20), Matthews 23-24 491 vs 511 (-20), Trocheck 23-24 521 vs 529 (-8); the two **22-23** cards (McDavid 555, Draisaitl 516) are **not in the feed** |
| MLB | 10/10 | 4 | Ohtani 2023 622 vs 673 (-51), Ohtani 2022 651 vs 656 (-5), Judge 2024 593 vs 606 (-13), Acuna 2023 521 vs 555 (-34), Soto 2024 536 vs 546 (-10), Judge 2022 484 vs 518 (-34) |
| WNBA | 2/2 | 1 | Wilson 2025 675 vs 671 (+4) |
| PGA | 6/6 | 3 | Scheffler 2024 560 vs 531 (+29), Spieth 2015 558 vs 551 (+7), Im 2021 511 vs 504 (+7); raw >= guide as expected ("after triple overlaps") |

Overall 63/65 matched, 46 exact, 55 within 2 %. **No case is higher than the guide except golf/WNBA (expected).**

Probable causes of the shortfalls (all negative, never positive): (a) **All-Star / exhibition games** - Rateboard stores
rax 0 for several marquee players' all-star rows (NHL 23-24 ASG on 2024-02-03: McDavid/Draisaitl/Matthews each have two
rows worth 0, while 15 other players have positive rows; NBA 24-25 and 25-26 similar), matching the -4..-20 gaps; (b)
**World Baseball Classic** games (March 2023 - Ohtani, Acuna) are absent for 2023 (the feed has a gap 2023-02-28 ..
03-26), matching the -34 / -51 gaps; (c) two-way players (Ohtani 2022-23) and a ~15 % thinner MLB 2022 feed. These are
hypotheses from the pattern, not confirmed with Rateboard. Impact on OTD: a few missing mid-sized claims for some
stars; the totals and 99 % of the claim calendar are right.

### The July-2026 buff finding
**Rateboard's CBB and CFB numbers already include the buff.** All 20 CBB/CFB reference cards, including the three the
guide marks "post-buff (was ...)" - Edey 708 (was 565), Jeanty 669 (was 537), Skattebo 616 (was 491) - match to the
unit, i.e. ratio 1.000, not 1.25. **No correction factor is needed** (do not multiply CBB/CFB by 1.25 again). Probably
Rateboard re-pulled the data after the change, so the rules agent should model the *current* multipliers, not
the old ones.

### Other findings
- Σ game rax == players-endpoint `rax` for every card checked (annual is exactly the sum of its game rows).
- `rax` per game is an integer (rounded from `rating`); non-zero all-star rows exist for most sports.
- `seasonType` values seen: `regularseason`/`regular`, `postseason`, `allstar`, `preseason` (always 0 rax, never kept).
  WBC 2026 and the 2025 NHL Four Nations games are tagged `allstar` -> flag 2.

## Known gaps

- **Soccer**: only season key 2025, which spans 2025-08-15 .. 2026-09-27 (European 25-26, the 2026 World Cup / qualifiers
  tagged `WC`, MLS and others under one key), so "soccer 2025" is a mix of competitions; per-card `annual` is large
  (Olise 776) because Real pays big per-game Rax in soccer. Season 2026 (from 2026-07) is excluded as in progress. Only
  ~1 season means few distinct claim days per card; no soccer reference cards exist to validate against.
- **WNBA**: only 3 seasons; 2026 finals ongoing (annual totals for finalists will rise).
- **UFC**: no per-game source at all.
- **Older seasons**: NFL/CFB before 2023, NBA before 22-23, NHL before 23-24 (the guide's 22-23 NHL cards cannot be
  matched), MLB before 2022, CBB before 23-24 are not collected by Rateboard. Golf goes back to 2014.
- **Possibly thin seasons**: CBB 2024 (23-24: 51k rows / 4,358 players vs 76k / 5,200 later) and MLB 2022 (72k rows vs
  ~85k) have noticeably fewer rows than their neighbours.
- **In-progress seasons excluded**: NFL / NHL / CFB 2026 (26-27) and soccer 2026. MLB / PGA / WNBA 2026 are included but
  not final.
- Cards outside "top 400 per sport + day-toppers" are not present (the long tail of low-rax cards never wins a claim).
- All-star / WBC rax gaps described above. Deep-October MLB teams' 2026 annual totals will grow when the postseason ends.
- `owners` is the current owner count at build time, not historical.
