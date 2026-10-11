import { Flame } from 'lucide-react';
import type { MarketUnit, SpikeRow } from '../../types/market';
import { dec, rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';

const TAG_STYLE: Record<string, string> = {
  'Game Tonight': 'chip-blue',
  'OTD Anniversary': 'chip-emerald',
  'Injury Replacement': 'chip-amber',
  'Streak Multiplier': 'chip-muted',
};

/** Cards whose 24h volume or average bid is > 2σ above their 7-day trailing baseline. */
export default function SpikeCards({ spikes, selected, onSelect, unit = 'rax', waiting, emptyNote }: { spikes: SpikeRow[]; selected: string | null; onSelect: (key: string) => void; unit?: MarketUnit; waiting?: string; emptyNote?: string }) {
  const rate = unit === 'rate';
  const sales = unit === 'sales';
  if (waiting) return null; // the history-progress notice above explains why
  if (!spikes.length) {
    return (
      <div className="panel">
        <Empty title={rate ? 'No demand spikes right now' : sales ? 'No price spikes in your captured sales' : 'No velocity spikes right now'}>
          {emptyNote ?? (rate ? 'No player’s best bid rate or buyer count is more than 2 standard deviations (and materially) above its 7-day baseline.' : 'Nothing is more than 2 standard deviations above its 7-day baseline.')}
        </Empty>
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {spikes.slice(0, 12).map((s) => (
        <button
          key={s.key}
          onClick={() => onSelect(s.key)}
          aria-pressed={selected === s.key}
          className={`panel p-3 text-left transition-colors hover:bg-hover ${selected === s.key ? '!border-amber' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{s.playerName}</div>
              <div className="text-[11px] text-muted">
                {s.sport}
                {!rate && (
                  <>
                    {' '}· <span className="num">{s.rating}</span> {s.rarity}
                  </>
                )}
              </div>
            </div>
            <span className="chip-amber num" title="Standard deviations above the 7-day baseline">
              <Flame size={11} /> {s.z > 20 ? '20σ+' : `${dec(s.z, 1)}σ`}
            </span>
          </div>
          <div className="num mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted">{rate ? 'Buyers standing (24h avg)' : sales ? 'Sales you captured (24h)' : '24h volume'}</div>
              <span className={s.volumeZ > 2 ? 'text-amber' : ''}>{rate ? dec(s.volume24h, 1) : rax(s.volume24h)}</span> <span className="text-muted">vs {rate ? dec(s.volumeBaseline, 1) : `${sales ? dec(s.volumeBaseline, 1) : rax(s.volumeBaseline)}/d`}</span>
            </div>
            <div>
              <div className="text-muted">{rate ? 'Best bid rate (24h avg)' : sales ? 'Median sale price (24h)' : 'Avg bid 24h'}</div>
              <span className={s.avgBidZ > 2 ? 'text-amber' : ''}>{rate ? `${dec(s.avgBid24h, 1)}/1` : rax(s.avgBid24h)}</span> <span className="text-muted">vs {rate ? `${dec(s.avgBidBaseline, 1)}/1` : rax(s.avgBidBaseline)}</span>
            </div>
          </div>
          {s.catalysts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {s.catalysts.map((c) => (
                <span key={c} className={TAG_STYLE[c]}>
                  [{c}]
                </span>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
