import { ExternalLink } from 'lucide-react';
import { rateboardTradeUrl } from '../../../shared/rateboard';
import { slug } from '../../lib/format';

/** The outbound "Trade / List this Card on Rateboard" button required on every listed card. */
export default function TradeLink({ player, sport, compact }: { player: string; sport: string; compact?: boolean }) {
  return (
    <a
      className="btn-ghost btn-sm !no-underline whitespace-nowrap"
      href={rateboardTradeUrl(slug(player), sport)}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens Rateboard in a new tab"
    >
      {compact ? 'Trade / List on Rateboard' : 'Trade / List this Card on Rateboard'} <ExternalLink size={12} />
    </a>
  );
}
