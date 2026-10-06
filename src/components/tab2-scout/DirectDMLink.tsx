import { ExternalLink, MessageSquare } from 'lucide-react';
import { realDeepLink, realLink } from '../../../shared/formulas';

/** Universal web/mobile link + native deep scheme into the bidder's DM. */
export default function DirectDMLink({ username, userId, compact }: { username: string; userId: string; compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <a className="btn-ghost btn-sm !no-underline" href={realLink(username)} target="_blank" rel="noopener noreferrer" title={realLink(username)}>
        Profile <ExternalLink size={12} />
      </a>
      <a className="btn-ghost btn-sm !no-underline" href={realDeepLink(userId)} title={`${realDeepLink(userId)} — opens the DM in the Real app if installed`}>
        <MessageSquare size={12} /> {compact ? 'DM' : 'DM in app'}
      </a>
    </span>
  );
}
