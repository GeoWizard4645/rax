# Capturing real data from your own Real session

## Start here: the recorder (Tabs 2–3)

The easy, supported way is the read-only **recorder** — no DevTools, no copying response bodies. In Tab 2 or Tab 3 open **"Capture real Real-marketplace data from your own session"**, drag the bookmarklet to your bookmarks bar (or paste the shown code in the browser console), open realapp.com signed in, go to the Marketplace and click it. Scroll the auctions you care about and open **Market data** on a few cards (Card / Player / Similar views); press **Export** in its box, paste into the box on the site, **Import**. Captures accumulate in your browser, so history grows each time you do it. It only reads the text already on your screen, makes no requests, clicks nothing and sends nothing; what it records, what it can't and its limits are in [MARKET-DATA-SOURCES.md](MARKET-DATA-SOURCES.md#real-marketplace-capture-tabs-23-the-default-when-you-have-captured-something). Real's terms discourage bulk data mining — record what you personally look at.

Everything below is the **older manual fallback** (copying response bodies from DevTools), kept in case the recorder breaks after a Real redesign, and for the other tabs' endpoints.

---

This is the legitimate version of "sniff the app's traffic". You look at **responses to requests your own logged-in app already makes**, and copy the response body. You never copy or reuse headers, cookies or tokens, and nothing is automated.

## What to capture and how

**Easiest: the Real web app in a desktop browser** (the phone does not need to be connected to anything).

1. Go to `realapp.com`, sign in as yourself.
2. Press **F12** → **Network** tab → filter **Fetch/XHR**. Tick "Preserve log".
3. Open the screen you want (marketplace, a card's auction history, OTD calendar, a poll…). New requests appear.
4. Click the request whose name looks right (see the table) → **Response** tab → select all → copy.
5. Paste it into the app (Tab 2 → *Import real auctions*), or into a file and send it to me.

**From a phone instead:** a proxy *viewer* (HTTP Toolkit, Proxyman, Charles) on a laptop lets you read the same responses while you use the app. Same rule: copy bodies only. It's a one-off; the phone doesn't stay connected.

## Which requests I'd like to see (paths from Real's web client)

| For | Request name to look for |
|---|---|
| Tab 2/3 auctions & prices | `cardmarketplacelistings`, `cardmarketplaceoffers`, `cardauctionhistory/…`, `bidhistory`, `marketplace/fmv/…` |
| Tab 4 OTD | `cardhistoricalearnings`, `cardhistoricalearnings/calendar` |
| Tab 5 earnings | `userpassearnings/day/…` |
| Tab 6 polls | `polls/…`, `pollleaderboard` |
| Tab 1/5 profile & cards (with rarity) | `user/profile`, `collection/…`, `cardalbums` |

**Redact first if you like** — usernames of other people aren't needed to build the adapters, only the *shape* (keys and value types). Replace values freely; keep the keys.

## The three captures to ask for (exact, so importers can use real field names)

Everything else in this guide is generic; if you only do three things, do these — on the Real web app (realapp.com) while signed in as yourself, DevTools → Network → Fetch/XHR, copy the **Response** body only (right-click → Copy → Copy response), never headers, cookies or tokens:

1. **Marketplace listings** — open the Marketplace tab (the main list of auctions) and copy the response of the request named `cardmarketplacelistings`. Please include 10+ listings, and also paste the request's **URL path and query string** (just that line, e.g. what follows `web.realapp.com`) so we know the filters/paging. Note on the screen what one listed card shows (player, rating, rarity, current bid, time left) so we can map the fields to what you see.
2. **Auction / bid history of one card** — open one card that has had several bids (5+ if you can) and copy the response of `cardauctionhistory/<id>` (or `bidhistory` / `bidinfo`, whichever the card screen fires; if both appear send both). Add the card's rating and rarity as displayed.
3. **Fair market value of that same card** — the response of `marketplace/fmv/…` for the same card, plus `cardtradehistory/<id>` if the screen requests it. (Optional fourth, cheap and valuable: `cardmarketplaceconfiguration` — fees and limits.)

Why these three: they are the only places the market's rating, rarity, price, bidder and time fields would appear together. Once we have them: Tab 2 gets a real auction importer (instead of guessing field names), Tab 3 gets real price points plus FMV to anchor the fair-value scatter, and the baseline premium switches from bid rates to real sale prices. Redact usernames if you like; keep keys and value types. **Not requested and not done:** any script that calls these endpoints for you, or anything that reuses your session or tokens.

## What this unlocks

- **Now:** Tab 2 imports any JSON list and maps its fields (it guesses, you can correct). Each import also adds to your 7-day baselines, so premiums become meaningful after a couple of imports.
- **With a few sample responses from the table above:** I can add one-click importers for OTD games (Tab 4), polls (Tab 6), earnings (Tab 5) and prices/fair value (Tab 3), with the exact field names baked in instead of guessed.
- **If you ever get official access** (Real API key, or Rateboard sharing their data): I'd need the base URL, auth scheme, rate limits and one sample response per endpoint — then the existing proxy and `normalizeAuction` get pointed at it.

## What this does not do

Automatic, continuous collection. Real's API requires a signed per-request token and a Turnstile check on every call; reproducing those from a server would be circumventing access controls, so the app doesn't — see `DATA-SOURCES.md`.
