# Real Sports predictions — how they pay (what is known, what is assumed)

Companion to `shared/realPayout.ts` (maths) and `docs/ODDS-SOURCES.md` (fair probabilities). Same confidence tags as `docs/OTD-MECHANICS.md`: **documented** (Real's own docs/changelog), **community** (third party), **inferred** (our deduction), **unknown**. Snapshot 2026-10-11. Real changes things often — re-verify.

## Bottom line

Real's prediction product is **not documented well enough to state its payout formula**. What *is* documented is enough to fix the shape of the model: a Pro-only, Rax-denominated, peer-to-peer "automated market" where the displayed percentage is the community's implied probability and lower percentages pay more. The model in `realPayout.ts` is therefore the simplest one consistent with that — a share priced at the displayed percentage that pays 1 Rax if the side wins — with **every undocumented knob (rake, rake basis, price impact, stake limits) exposed as an editable `RealRules` parameter, defaulting to a labelled placeholder**. The 2-minute in-app check at the bottom calibrates the two that matter most (rake and price impact) from numbers Real shows before you confirm a stake.

## What Real says (documented)

| Fact | Source |
|---|---|
| Predictions are a **Real Pro** feature; "Compete against the community using Rax to predict the outcomes of games"; found on game screens on game days | [docs.realapp.link/basics/real-pro](https://docs.realapp.link/basics/real-pro) |
| Supported markets: **game winners and total points** | same |
| "The percentages shown in markets reflect the likelihood the community thinks something will happen." **"Lower percentages result in higher Rax payouts."** | same |
| 2025-12-20: "Prediction market beta for Pro members. Community-driven markets for game winners with Rax. **Automated market fully peer-to-peer with cashout functionality**" | [docs.realapp.link/updates/changelog](https://docs.realapp.link/updates/changelog) |
| Jan 2026 prediction UI; Feb 2026 "Predictions", prediction portfolio performance view, futures markets + market sharing, soccer markets/WBC; Mar 2026 futures predictions; Jun 2026 portfolio all-time filter + calendar; Aug 9 shareable portfolio; Aug 25 prediction ticket stub | same |
| Rax is bought in-app (purchases final, Pro buyers get +10% Rax), earned from karma/leaderboards/brawls/OTD | [docs.realapp.link/basics/rax](https://docs.realapp.link/basics/rax), real-pro |
| Contrast, *not* predictions: the older **karma polls** are spread-based, with moneyline odds shown in the karma popup since 2022 ("10 is added, then rounded up to the nearest 10"); **Arena** Rax pots are "winner takes pot minus 10%" | changelog; `docs/OTD-MECHANICS.md` |

## What third parties say (community)

RaxEdge (raxedge.com, paid) — landing page, fetched 2026-10-11:
- EV formula: **`EV = (FD Fair / Real Yes) × (1 − rake) − 1`**; `Edge = FD Fair% − Real Yes%`; labels EV slight 0–2%, solid 2–5%, strong 5–10%, excellent 10%+. "Green = value betting YES on Real."
- It never states the rake value, the payout formula or a stake limit. "Win up to 10,000 Rax per slip" refers to its 2–5-leg **player-prop "More or Less" parlays** (a separate Real product), so it is *not* evidence about game-winner markets.
- Features named but not explained: "Real sensitivity analysis" (Pro), "Unit Size (Rax)".
Reading the formula: buying YES at Real's `p` pays `1/p` per Rax staked, scaled by `(1 − rake)` — i.e. a rake on the *payout*. That is the model implemented as `rakeBasis: 'payout'`.

## The model

For a side priced at `p = realMarketPct/100` and a stake `s` Rax:

```
net multiple M = (1/p) × (1 − rake)                      rakeBasis 'payout' (RaxEdge's form, default)
               = 1 + (1/p − 1) × (1 − rake)              rakeBasis 'profit'
EV% = (fair × M − 1) × 100                               (evPct)
break-even Real % = fair × (1 − rake)                    (breakEvenPct; buy only below this)
Kelly: f* = (fair·M − 1)/(M − 1);  stake = floor(f* × fraction × bankroll)     (kellyStake, fraction default ¼)
```
- **Sensitivity** (`sensitivity`): EV as Real's percentage moves ± N points — the percentage drifts as the pool fills during the day. Rows + the break-even percentage; EV is strictly decreasing in `p`.
- **Price impact** (`model: 'pool'`, needs `poolRax`): your stake joins your side's pool, so the price you effectively pay is `(p·T + s)/(T + s)` for total pool `T`. This is the pari-mutuel / AMM-like reading of "automated market". `stakeSensitivity` and `recommendStake` use it (growth-optimal stake under impact, scaled by the Kelly fraction). Default is `'fixed'` (the shown percentage is what you get).
- **Not modelled:** cashout (exit at the then-current percentage, fee unknown), early-exit EV, ties/postponements, futures.

### Confidence of each rule (`REAL_PREDICTION_FACTS`)

| Rule | Value in model | Confidence |
|---|---|---|
| Pro-only, Rax-denominated | — | **documented** |
| Markets: game winner, total points (+ futures, soccer) ; spread markets not mentioned | — | **documented** |
| Percentage = community implied likelihood; lower % → higher payout | `M` decreasing in `p` | **documented** |
| Peer-to-peer automated market with cashout | — | **documented** |
| Winning payout ≈ stake ÷ displayed % (a share priced at p pays 1) | `M = 1/p …` | **inferred** (consistent with the docs + RaxEdge) |
| EV formula `fair/RealYes × (1 − rake) − 1` | `rakeBasis 'payout'` | **community** |
| **Rake / fee** | `rake = 0.05` placeholder | **unknown** — RaxEdge has a rake term but no value; Real publishes none |
| Rake basis (payout vs profit) | `'payout'` | **unknown** |
| Does your stake move the price? how much? | `'fixed'` | **unknown** (an "automated market" suggests yes) |
| Min / max stake | `null` | **unknown** |
| Cashout fee, tie/postponement handling | not modelled | **unknown** |

`DEFAULT_REAL_RULES.rake = 0.05` is a *placeholder*, not a finding. If the true rake is 0 the tool understates EV by ~5 points; if it is 10% (Arena's documented rake on Rax pots) it overstates by ~5. Use `maxRakeForBreakeven(fair, realPct)` in the UI ("this bet still wins if the rake is under X%") until the check below pins it.

## Open questions

1. Is there a rake, how large, on payout or profit? Is it also charged on cashout?
2. Does a stake move the percentage (pool size)? Is the shown percentage a pool share, an order-book mid, or an AMM price?
3. Is the displayed percentage per side (so YES% + NO% = 100%) or are both quoted with a built-in margin?
4. Min / max stake per market and per user; does Pro level or Karma change them?
5. Which markets exist beyond game winner / total points (spread? 1H? props)? Are totals priced on several lines?
6. How are ties (NFL/soccer 3-way), overtime, postponements, and push on integer totals settled?
7. Is the market also open to non-Pro users to *view* percentages?

## 2-minute in-app check (no Rax at risk)

Do it on any live game with a market. Write down every number.

1. **Percentages.** Note both sides' percentages (e.g. 58% / 42%). If they sum to 100% there is no built-in margin; if they sum to more, the excess is margin (tell the tool: use a smaller `p` or raise the rake accordingly).
2. **Small quote.** Open the stake sheet for the side you'd buy, type a small stake `s₁` (e.g. 100 Rax). Without confirming, read the *potential payout* `W₁` (or "to win" — add back the stake if it shows profit only).
   - Rake (payout basis): `rake = 1 − W₁ × p / s₁` → `rakeFromQuote(pct, s₁, W₁)`. Rake (if the app shows *profit* `W₁ − s₁` is cut by the fee): `rakeFromQuote(pct, s₁, W₁, 'profit')`. If `W₁ ≈ s₁/p` exactly, rake = 0.
   - Try a second tiny stake (e.g. 50): the multiple `W/s` must be identical. If it isn't, there is already price impact at small size.
3. **Large quote.** Type a big stake `s₂` (e.g. 25–50% of your Rax) and read `W₂` and whether the displayed percentage itself changes while typing. If `W₂/s₂` is clearly lower than `W₁/s₁`, the price moves: `poolFromQuotes(pct, rake, { stake: s₂, payout: W₂ })` estimates the pool size → set `model: 'pool'`, `poolRax`.
4. **Limits.** Type `1`, then a huge number; note the min/max the sheet enforces → `minStake`, `maxStake`.
5. **Cashout (optional, costs the round trip).** Only if you want the exit fee: place the minimum stake, open it in the portfolio, compare the cashout value to the stake × (current % ÷ entry %). Skip it otherwise — the EV tool does not use it.
6. Send the numbers (percentages, `s₁/W₁`, `s₂/W₂`, limits) and the `RealRules` can be set to measured values and the facts re-tagged from *unknown* to *community*/*documented*.

Do not confirm a stake just to test — the confirm screen quotes the payout before you commit.
