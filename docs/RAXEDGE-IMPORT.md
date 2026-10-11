# Importing your passes from RaxEdge

**What it is.** RaxEdge (raxedge.com) knows every pass you own — its exact level and per-day earnings, including **team cards and UFC fighters**, which Rateboard's per-game data doesn't cover. The *My cards* view of Tab 7 can import that, so Tabs 7 and 8 work from your real set instead of an approximation.

**How it stays safe.** RaxEdge's OTD endpoints (`/api/real/otd?action=user_passes_all | earnings_bundle | earnings | search_users`) only answer to a logged-in RaxEdge session cookie, and they send no CORS permission, so another website cannot use that cookie — and we never ask for it. Instead you run a small snippet **in your own browser while on raxedge.com** (bookmarklet or console paste). It reads your own data with your own session and shows a box with a Copy button. You paste the text into RAX; it is parsed in your browser and stored in `localStorage`. Nothing is sent to any server of ours. The snippet only calls RaxEdge's own same-origin endpoints (a unit test enforces that it contains no other network calls).

**Steps.** Tab 7 → *My cards* → *Import from RaxEdge*: drag the bookmarklet (or copy the code), open raxedge.com → On This Day, click it (it asks for your Real username if none is loaded), press **Copy**, paste, **Import**.

**What was verified (2026-10-11).** Exporting the public profile `boston` (1,791 passes — the same count Real shows) and loading it into Tab 8 reproduces RaxEdge's October calendar: 648,733 vs 649,373 Rax with 2 claims (−0.1%), 695,472 vs 696,438 with 3 claims, and ~25 of 31 days to the exact Rax. Remaining differences are a few Rax of per-game rounding on fractional multipliers.

**Level numbers** (RaxEdge / Real): 0 General, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5–9 Legendary 1–5, 10–19 Mystic 1–10, 20+ Iconic 1+.
**Multiplier scales.** Players: Real's ladder (`shared/otdRules.ts`). Team cards: 1.2× (Common) … 6× (Iconic) — RaxEdge's table. UFC: 1× … 24.5× (RaxEdge's table). Note RaxEdge's feed tags UFC fighters as `entityType: "team"`; they still use the UFC scale. Team/UFC multipliers and caps follow RaxEdge's tables; Real's own team-card page may differ — treat as approximate.

**Rules the calendar applies** (learned from the comparison): OTD pays on the anniversary of a game from an **earlier year** (a game played on 2026-10-03 first pays 2027-10-03); 2 guaranteed claims per sport per day with teams and players sharing them; Pro's "3 claims" adds one extra claim per day across all sports.
