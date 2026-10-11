import { AlertTriangle } from 'lucide-react';

/** Site-wide honesty banner: what is live, what is sample, and why. Native <details> so it works without JS state. */
export default function LimitationsBanner() {
  return (
    <div className="border-b border-amber/30 bg-amber/5" role="note" aria-label="Data limitations">
      <details className="mx-auto max-w-[1500px] px-3 py-2 text-xs text-amber/90 sm:px-4">
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Not all data here is live. Real's marketplace prices, auctions and poll results aren't publicly available, so those panels use Rateboard bids, your own import, or labelled sample data.
          </span>
          <span className="ml-auto shrink-0 underline">details</span>
        </summary>
        <div className="mt-2 grid gap-3 text-[11px] leading-relaxed text-muted sm:grid-cols-3">
          <div>
            <b className="text-emerald">Live</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Offer board, player search, card collections, UFC fighter status, owners / season Rax and per-game Rax logs (powering Tabs 7–8) — from Rateboard's API, used with its owner's permission (collections are cached ~2 h).</li>
              <li>Game schedule, times, broadcasters and status — ESPN's public scoreboards.</li>
              <li>Card artwork — Real's public image CDN.</li>
            </ul>
          </div>
          <div>
            <b className="text-amber">Sample or estimated</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Real auction bids, card sale prices, fair value and price history (Tabs 2–3) — Real's own API needs a signed-in app session, so this site pulls nothing from it. When you have captured data from your own Real session (a read-only recorder you run on realapp.com), both tabs default to that "Real marketplace" source: live auctions with real reference prices, sale-based price history and Real's own market stats — only what you opened, bidders unknown, history grows each time you capture. Otherwise they default to Rateboard's standing buy offers (bid RATES in Rax per rating point, not sale prices; card rating and rarity unknown); "Imported snapshot" and "Sample" stay selectable and are labelled.</li>
              <li>Tab 3 history starts when recording started and needs 3 days before spikes, candles and forecasts appear.</li>
              <li>Poll percentages, game pace and polls-per-game (Tab 6) — estimates.</li>
              <li>Tabs 7–8: earnings come from a dated snapshot of Real's per-game Rax; card prices are estimates (Real publishes none). A username pull only knows players and total rating, not each pass's level.</li>
            </ul>
          </div>
          <div>
            <b className="text-head">Also worth knowing</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Rateboard demand reflects what buyers offer there, not what cards sell for on Real. Tab 7 ranks the top cards in a dated snapshot, not every card ever made.</li>
              <li>Live panels depend on Rateboard and ESPN being up; they can lag or fail without notice.</li>
              <li>Unofficial fan tool, not affiliated with Real. Not financial advice.</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
