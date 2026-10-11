# RAX as an MCP server

**Endpoint:** `https://rax.vivaanshahani.com/mcp` — [Model Context Protocol](https://modelcontextprotocol.io), Streamable HTTP transport, public, read-only, no authentication.

The **MCP** button at the top right of the site opens a dialog with this URL, copy-paste configs for popular clients, a live status check and a "try it" runner. Opening `/mcp` in a browser redirects there (`/?mcp=1`).

## Connecting a client

Add a *remote / HTTP* MCP server named `rax` with the URL above. No headers or keys.

| Client | How |
|---|---|
| **Instinct** | Settings → add a remote (HTTP) MCP server → paste the URL, transport *Streamable HTTP*, auth *none*. If it wants JSON: `{"mcpServers":{"rax":{"type":"http","url":"https://rax.vivaanshahani.com/mcp"}}}` |
| Claude (claude.ai / Desktop) | Settings → Connectors → Add custom connector → paste the URL |
| Claude Code | `claude mcp add --transport http rax https://rax.vivaanshahani.com/mcp` |
| Cursor | `.cursor/mcp.json`: `{"mcpServers":{"rax":{"url":"https://rax.vivaanshahani.com/mcp"}}}` |
| VS Code | `.vscode/mcp.json`: `{"servers":{"rax":{"type":"http","url":"https://rax.vivaanshahani.com/mcp"}}}` |
| stdio-only clients | `{"mcpServers":{"rax":{"command":"npx","args":["-y","mcp-remote","https://rax.vivaanshahani.com/mcp"]}}}` |

Quick check from a terminal:

```bash
curl -s https://rax.vivaanshahani.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"otd_payout","arguments":{"rarity":"Legendary 3","generalRaxPerSeason":700}}}'
```

## What it exposes

**Tools** (all read-only; JSON in, JSON out as text + `structuredContent`):

| Tool | What it does |
|---|---|
| `search_docs` | BM25 search over Real's public docs (docs.realapp.link), this repo's research notes and the site guide; returns passages with source URLs |
| `read_doc` | List or read whole knowledge-base documents |
| `list_tabs` | The site's tabs and routes |
| `otd_rules` | The rarity ladder (multiplier, rating needed, cap), per-sport rating→Rax factors, OTD claim rules with their confidence, pack prices |
| `otd_payout` | Annual payout / per-claim payout / cost / payback for a card at a rarity |
| `otd_top_cards` | Best cards in the observed OTD dataset by annual payout or payback at a rarity (top ~150 per sport; full-year, ignores overlaps — Tab 7 handles those) |
| `ev_calc` | EV%, break-even %, edge and fractional-Kelly stake for Real's prediction market, given fair probability and the % Real shows |
| `odds_convert`, `devig` | American / decimal / fractional / probability conversion; vig removal (proportional or power) |
| `live_odds` | Upcoming games with consensus no-vig probabilities from Kalshi, Polymarket and DraftKings-via-ESPN (same data as Tab 9) |
| `schedule` | Upcoming games from ESPN's public scoreboards (Tab 6's data) |
| `rateboard_owed` | Rating × rate rounded to the nearest 10 Rax, and the exact Rateboard copy-message |
| `quads_payouts`, `calculate` | Quads payout tiers; a safe arithmetic evaluator |

**Resources:** `rax://site/tabs` and `rax://doc/<id>` for every knowledge-base document. **Prompts:** `plan_otd_budget`, `evaluate_prediction_edge`, `explain_real_rule`, `rateboard_price_check`.

## What it does *not* do

- It cannot see or change anything in your browser session (your cards, inputs, Rateboard login). The chat assistant can — that is a different, browser-side feature ([ASSISTANT.md](ASSISTANT.md)).
- No writes of any kind: it cannot post Rateboard offers, spend Rax or call anything authenticated.
- Card prices are estimates and Real's prediction rake is unknown — tool outputs say so. Not financial advice; not affiliated with Real.

## Implementation notes

- `functions/mcp.ts` (HTTP) + `functions/_lib/mcp.ts` (JSON-RPC engine). Stateless: every POST gets a JSON reply (the spec allows this), no `Mcp-Session-Id`, no SSE stream (`GET` with `Accept: text/event-stream` → 405, which the spec permits). Protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05` are negotiated; batches and notifications are handled.
- Tools live in `shared/agent/tools.ts` and are shared with the chat assistant, so they are covered by `tests/agent/`.
- Limits: 64 KB request bodies, 240 requests / 10 min / IP (soft, per data centre — Cache API), live-data tools reuse the site's own cached endpoints (≤ 50 upstream subrequests, ~45–600 s cache).
- Free-tier friendly: no Durable Objects, no AI binding, no KV writes. The docs search is an inverted index fetched from static assets (`/data/kb/*`, built by `npm run kb`).
- CORS is open (`*`) — it serves public data and uses no cookies or credentials.
