# The "modeled" OTD method — rating model

How Real turns a player's game into a **rating** and then into **OTD Rax**, reverse-engineered so OTD earnings can be
computed for any player-season from free ESPN data, without opening cards in Real.
Code: `shared/ratingModel.ts` (pure; coefficients + accuracy are GENERATED blocks), `scripts/fit-rating-model.mjs` (fit +
validation), `scripts/build-modeled-snapshot.mjs` (→ `public/data/otd-modeled.json`), `scripts/lib/*` (cached fetch + ESPN
parsers + evaluator). Full numeric report: `docs/rating-model-fit.json`.

## 1. Step A — rating → Rax is exact

For every sport checked, Rateboard's stored per-game Rax obeys

    rax = max(0, round(k × rating))        (round half up; ×2 for postseason / majors)

with a **single factor k per sport/group**. 100% of rows matched in NBA (≈ 90k rows, 3 seasons), NFL 2023-25, NHL
skaters/goalies 2023-24, MLB hitters, CBB/WNBA base rows. This confirms Real's published factors (`docs/OTD-MECHANICS.md`):

| Sport | k (regular) | Notes |
|---|---|---|
| NBA | 1 | all-star ×2 |
| WNBA | 2 | |
| CBB | 2.5 | buffed ×1.25 in Jul 2026 — Rateboard already shows 2.5 for 2024-25 and 2025-26 |
| NFL | offense + kickers 5, defense + punters 7 | Rateboard's 2023-24 NFL rows still use 5 for defense; 2025 uses 7 |
| CFB | offense + kickers 5, defense + punters 8 | |
| NHL | skaters 1.2, goalies 3 | |
| MLB | hitters 2, SP 3, RP 5 | Rateboard's **MLB 2025** rows still use the pre-buff 1.5 / 2 / 4 |

Rating is negative for terrible games ⇒ Rax 0. The thresholds are clean (NHL skater: rating 0.417 → 1, 1.25 → 2, 2.083 → 3
… i.e. `round(1.2·r)`). Pitcher role: SP vs RP is not a stat-line fact; "≥12 outs ⇒ SP" gets 95–97% of pitcher games right.

### What rating→Rax does *not* explain: the low-owner uplift (observed, mechanism unknown)

In recent data Rateboard's Rax is **higher than `round(k × rating)` for players few people own**: ×1.45–1.55 for the bottom
half by owners, ≈ ×1.2 around the 80th percentile, ×1.00 for the top 10% (stars with 10k+ owners are unaffected; NBA
Wembanyama's 480 = exactly the modeled 482). Onset by data: CFB from Sept (2024 and 2025), MLB 2025 from Sept, NFL/NHL/NBA/CBB
from Dec, WNBA throughout; not present in NFL 2023-24, NHL 2024, NBA 2024-25, MLB 2023-24. My reading is that Rateboard
stores recomputed values before some date and Real's live payouts (which carry the bonus) after, but that is a guess. The
model ignores it by default; `ctx.ownersPercentile` applies a crude pooled table. It matters most for CFB (7k players, most obscure):
the "actual top 150" there is full of obscure defenders inflated 1.4×. Honest consequence: ranking by *modeled* Rax understates
cheap, obscure cards.

## 2. Step B — stats → rating

Ridge-OLS per sport and position group (additive terms; a few hinge terms `max(0, x−t)` chosen greedily on held-out days).
No ML, no interactions; every coefficient is in `MODEL_DATA` (shared/ratingModel.ts). The stat → rating relation is almost a
fantasy-style linear score: e.g. NFL rushers/receivers ≈ 0.033/rush yd, 0.035/rec yd, 0.92/TD, −0.42 per lost fumble, ≈0 per
reception (non-PPR); NBA ≈ 0.11 pts, 0.08 reb, 0.17 ast, 0.18 stl/blk, −0.18 tov (plus a hinge above 20 pts). Groups:
NFL/CFB QB, rusher/receiver, defender (catch-all), kicker, punter; NHL skater, goalie; MLB hitter, pitcher; one group for basketball.

Training: Rateboard `rating` joined to ESPN box-score lines by (day, normalised name) — ≈ 95–99% of Rateboard rows match
(unmatched = linemen/long-snappers etc. with no ESPN line, and rare name clashes). NBA/WNBA/CBB train on Rateboard's own stat line
(identical to the box score). **Held-out = a whole later season** (train 2023+2024 → test 2025; NBA/CBB test 2026; WNBA train 2024 → test 2025).

| Sport | train → test | held-out rows | R² rating | MAE rating | MAE Rax vs Real's | MAE Rax vs round(k·true rating) | exact Rax | ±1 Rax | weakest group (R²) |
|---|---|---|---|---|---|---|---|---|---|
| NBA | 2024-25 → 2026 | 8,250 | **0.970** | 0.17 | 0.38 | 0.19 | 66% | 97% | – |
| WNBA | 2024 → 2025 | 5,671 | 0.971 | 0.17 | 0.95 | 0.36 | 40% | 78% | – |
| CBB | 2024-25 → 2026 | 15,405 | 0.968 | 0.19 | 1.21 | 0.50 | 37% | 71% | – |
| NFL | 2023-24 → 2025 | 5,413 | 0.947 | 0.16 | 1.50 | 0.97 | 41% | 73% | DEF 0.89, K 0.91 |
| CFB | 2023-24 → 2025 | 1,938 | **0.896** | 0.23 | 3.01 | 1.96 | 23% | 52% | **DEF 0.81**, skill 0.92 |
| NHL | 2023-24 → 2025 | 3,010 | 0.985 | 0.12 | 0.40 | 0.15 | 67% | 95% | – |
| MLB | 2023-24 → 2025 | 3,865 | 0.967 | 0.19 | 0.62 | 0.28 | 70% | 91% | hitters 0.96 |

"MAE Rax vs Real's" includes the low-owner uplift (and k mismatches); "vs round(k·true rating)" isolates pure rating error. Before the
uplift regime (NBA test games before Dec 2025) the NBA Rax MAE is 0.18. Win probability / play-by-play leverage was tested on
NBA (ESPN `winprobability`, per-player ΔWP): R² 0.9612 → 0.9625 held-out, so it is **not used**. Golf and soccer are **not modeled**:
golf ratings depend on the whole field's scores (identical scores earn different ratings in different weeks), soccer on league/position.
UFC: no source.

## 3. Step C — ESPN pipeline proof and player-season totals

Everything below uses **only ESPN data → model → Rax**, compared with Rateboard's real totals for the same players (test season).
Box-score route = whole league season (≈1 scoreboard request per day + 1 box score per game, cached); game-log route = ESPN athlete
game log (NBA, WNBA).

| Sport (season) | route | players matched | share of Real's top-150 found | Spearman, all matched | **Spearman, top 150 by actual** | MAPE (top 150) | bias | top-150 overlap |
|---|---|---|---|---|---|---|---|---|
| NFL 2025 | box | 1,551 | 99% | 0.987 | **0.917** (top 50: 0.965) | 5.0% | −3.6% | 93% |
| NHL 2025 | box | 1,005 | 99% | 0.988 | **0.912** (top 50: 0.887) | 5.8% | −3.8% | 89% |
| CFB 2025 | box | 7,045 | 95% | 0.965 | **0.548** (top 50: 0.543) | 20% | −19.5% | 63% |
| NBA 2026 | game log | 50 sampled | – | 0.985 | **0.951** (top 30) | 3.2% | +0.1% | 97% |
| WNBA 2025 | game log | 45 sampled | – | 0.974 | **0.925** (top 30) | 7.5% | −6.6% | 97% |
| MLB 2025 | box | 1,409 | 100% | 0.986 | **0.630** (top 50: 0.645) | 17.7% | −18% vs Rateboard's stale-factor totals (+8.6% if Real's current 2/3/5 factors are used) | 84% |
| CBB 2026 | – | not validated at season level (ESPN college game logs are unreliable; box route needs ~2,000 games) | | | | | | |

Per-game proof (NBA game log, 3,837 real games): 67.5% exact, 97.7% within ±1 Rax, MAE 0.36; WNBA 44% exact / 84% ±1. Name-matching:
Rateboard ↔ ESPN by normalised name works for ≥97% (misses: players with no stat line; same-name pairs are skipped; ESPN lists
drafted college players under their NBA profile; ESPN's college game logs are frequently truncated to one game — so CBB uses box scores).

**Can it rank cards?** MLB: only moderately (0.63) — Rateboard's MLB 2025 values mix stale factors with a September uplift, and pitcher/hitter factors differ. NBA, NFL, NHL: yes (Spearman 0.91–0.95 on the 30–150 biggest seasons, totals within 3–6%). WNBA good.
CFB: **not reliably** (0.55) — good for offensive players, but Real's top CFB seasons include many obscure defenders whose payouts carry
the low-owner uplift and unobservable defensive credit. Feeding oracle owner percentiles through the crude uplift table improved
the CFB MAPE (20% → 12–15%) but not the ranking, and slightly hurt NHL/WNBA, so treat it as an experiment, not a fix.

## 4. Pros / cons

+ Covers any player-season from free data with a few thousand cached requests per sport-season instead of opening every card; transparent coefficients; exact final step.
+ Strong on NBA/NHL/NFL/MLB; errors average out over 17–160 games (annual totals within ~3–6% for stars).
− Reconstructs Real's rating, not Real's code: defense (NFL/CFB) and kickers are the weak spots; position-specific context (snap share, pressures) is invisible.
− Unmodeled low-owner uplift (needs owners; mechanism unknown); Rateboard's stored factors differ from Real's current ones in some seasons (MLB 2025).
− ESPN's APIs are unofficial and can change; no golf/soccer/UFC; CBB covers the 70 winningest teams only (if built).

## 5. Refit / rebuild

    export RAX_MODEL_CACHE=/some/dir          # raw responses cached here (gzip); re-runs are free
    node scripts/fit-rating-model.mjs --stage all --write      # fit, held-out eval, ESPN validation, rewrites GENERATED blocks
    node scripts/build-modeled-snapshot.mjs                      # ESPN-only snapshot -> public/data/otd-modeled.json

Politeness: ≤3 requests in flight, ≥150 ms apart, `rax-super-suite/0.1 (+https://rax.vivaanshahani.com)` on Rateboard requests.
A full MLB season of box scores is ≈2,500 requests; NHL ≈1,400; NFL ≈290; CFB ≈960.

ESPN endpoints used: `site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard?dates=YYYYMMDD`, `…/summary?event=ID`
(box scores, `winprobability`), `site.web.api.espn.com/apis/common/v3/sports/<sport>/<league>/athletes/<id>/gamelog?season=`,
`…/statistics/byathlete?…` (leaders), `…/common/v3/search?query=`. Rateboard: `/api/rax?gamelog=query&mode=games|players&…`.
Player ids in the modeled snapshot are **ESPN athlete ids** (Rateboard uses its own); match to observed cards by name.
