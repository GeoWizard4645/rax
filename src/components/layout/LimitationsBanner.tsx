import { AlertTriangle } from 'lucide-react';

/** Site-wide honesty banner: what is live, what is sample, and why. Native <details> so it works without JS state. */
export default function LimitationsBanner() {
  return (
    <div className="border-b border-amber/30 bg-amber/5" role="note" aria-label="Data limitations">
      <details className="mx-auto max-w-[1500px] px-3 py-2 text-xs text-amber/90 sm:px-4">
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Not all data here is live. Real's marketplace prices, auctions and poll results aren't publicly available, so those panels are sample or import-only.
          </span>
          <span className="ml-auto shrink-0 underline">details</span>
        </summary>
        <div className="mt-2 grid gap-3 text-[11px] leading-relaxed text-muted sm:grid-cols-3">
          <div>
            <b className="text-emerald">Live</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Offer board, player search, card collections, UFC fighter status, owners / season Rax and per-game Rax logs (powering Tab 4) — from Rateboard's API, used with its owner's permission (collections are cached ~2 h).</li>
              <li>Game schedule, times, broadcasters and status — ESPN's public scoreboards.</li>
              <li>Card artwork — Real's public image CDN.</li>
            </ul>
          </div>
          <div>
            <b className="text-amber">Sample or estimated</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Auction bids, card price history, spikes and forecasts (Tabs 2–3) — no Rateboard route carries them, and Real's own API needs a signed-in app session, so nothing is pulled from it.</li>
              <li>Tab 4 covers NFL, NBA, MLB, NHL, college football / basketball and golf only — not soccer, WNBA or UFC — and falls back to sample games if the feed is down.</li>
              <li>Poll percentages, game pace and polls-per-game (Tab 6) — estimates.</li>
            </ul>
          </div>
          <div>
            <b className="text-head">Also worth knowing</b>
            <ul className="mt-1 list-disc pl-4">
              <li>Rateboard demand reflects what buyers offer there, not what cards sell for on Real. Tab 4's "Who to buy" ranks the top anniversaries of the selected date, not every card.</li>
              <li>Live panels depend on Rateboard and ESPN being up; they can lag or fail without notice.</li>
              <li>Unofficial fan tool, not affiliated with Real. Not financial advice.</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
