import { ExternalLink, ShieldCheck } from 'lucide-react';
import { RB_ORIGIN } from '../../../shared/rateboard';

/** Full credit to Rateboard — this tab is a window onto their site. */
export default function OutboundBanner() {
  return (
    <div className="panel overflow-hidden border-action/40">
      <div className="flex flex-wrap items-center gap-3 bg-action/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-action">Powered by Rateboard</div>
          <p className="mt-0.5 text-sm text-head">
            This tab is a window onto <b>Rateboard</b>. Every action here — reading the board, searching players, pulling your cards, signing in, posting, changing and removing offers — is a real request to{' '}
            <a href={RB_ORIGIN} target="_blank" rel="noopener noreferrer" className="num">
              rateboard-cgi.pages.dev
            </a>
            . The offers, accounts, floors and rules all belong to Rateboard; nothing is stored here.
          </p>
        </div>
        <a className="btn-primary !no-underline" href={RB_ORIGIN} target="_blank" rel="noopener noreferrer">
          Open Rateboard <ExternalLink size={14} />
        </a>
      </div>
      <div className="flex items-start gap-2 border-t border-line px-4 py-2 text-xs text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald" />
        <span>
          Your board password is hashed in your browser and only the hash is relayed to Rateboard — we never see or keep it. Rateboard's public board also lists every account's password hash; our relay strips those (and private reports) before they reach your browser.
        </span>
      </div>
    </div>
  );
}
