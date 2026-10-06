# Capturing real data from your own Real session

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

## What this unlocks

- **Now:** Tab 2 imports any JSON list and maps its fields (it guesses, you can correct). Each import also adds to your 7-day baselines, so premiums become meaningful after a couple of imports.
- **With a few sample responses from the table above:** I can add one-click importers for OTD games (Tab 4), polls (Tab 6), earnings (Tab 5) and prices/fair value (Tab 3), with the exact field names baked in instead of guessed.
- **If you ever get official access** (Real API key, or Rateboard sharing their data): I'd need the base URL, auth scheme, rate limits and one sample response per endpoint — then the existing proxy and `normalizeAuction` get pointed at it.

## What this does not do

Automatic, continuous collection. Real's API requires a signed per-request token and a Turnstile check on every call; reproducing those from a server would be circumventing access controls, so the app doesn't — see `DATA-SOURCES.md`.
