import { useMemo, useState } from 'react';
import { buildContenderPitch, targetPrice } from '../../../shared/formulas';
import { samePlayer, type RbSport } from '../../../shared/rateboard';
import type { ContenderActivity } from '../../types/market';
import type { CollectionPlayer, Rarity } from '../../types/real';
import { ago, dec, rax } from '../../lib/format';
import { CopyButton } from '../ui/CopyButton';
import { Empty } from '../ui/StateBlock';
import DirectDMLink from './DirectDMLink';
import { toRb } from './UserMatcherTable';

const score = (c: ContenderActivity) => c.bids7d + 2 * c.buys7d;

/**
 * Repeat Contenders — Mystic / Legendary holders who are close to completing a card and have been bidding on and
 * buying the same player all week. Priced at the average per-rating they've actually been paying.
 */
export default function ContenderBoard({ contenders, collections, discount }: { contenders: ContenderActivity[]; collections: Partial<Record<RbSport, CollectionPlayer[]>>; discount: number }) {
  const [rarity, setRarity] = useState<'both' | Rarity>('both');
  const [minCopies, setMinCopies] = useState(3);
  const [minScore, setMinScore] = useState(8);
  const [onlyMine, setOnlyMine] = useState(false);
  const haveCollection = Object.keys(collections).length > 0;

  const rows = useMemo(() => {
    return contenders
      .filter((c) => (rarity === 'both' ? true : c.rarity === rarity))
      .filter((c) => c.copiesOwned === 0 || c.copiesOwned >= minCopies)
      .filter((c) => score(c) >= minScore)
      .map((c) => {
        const sp = toRb(c.sport);
        const mine = sp ? collections[sp]?.find((x) => samePlayer(x.name, c.playerName)) : undefined;
        return { c, mine };
      })
      .filter((r) => !onlyMine || r.mine)
      .sort((a, b) => score(b.c) - score(a.c));
  }, [contenders, rarity, minCopies, minScore, onlyMine, collections]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          Repeat Contenders <span className="num text-xs font-normal text-muted">({rows.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <div className="seg" role="group" aria-label="Rarity">
            {(['both', 'Mystic', 'Legendary'] as const).map((r) => (
              <button key={r} aria-pressed={rarity === r} onClick={() => setRarity(r)}>
                {r === 'both' ? 'Mystic + Legendary' : r}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            "Close" = owns ≥
            <input type="range" min={1} max={5} value={minCopies} onChange={(e) => setMinCopies(+e.target.value)} className="w-20 accent-[#3B82F6]" aria-label="Minimum copies owned" />
            <span className="num w-4 text-head">{minCopies}</span>
          </label>
          <label className="flex items-center gap-2">
            Activity ≥
            <input type="range" min={0} max={30} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-20 accent-[#F59E0B]" aria-label="Minimum activity score" />
            <span className="num w-5 text-head">{minScore}</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyMine} disabled={!haveCollection} onChange={(e) => setOnlyMine(e.target.checked)} /> only cards I own
          </label>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No contenders match" />
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th>Contender</th>
                <th>Chasing</th>
                <th className="r">Holds</th>
                <th className="r" title="bids + 2 × buys, last 7 days">Activity 7d</th>
                <th className="r">Avg paid / rating</th>
                <th className="r">Ask at your card</th>
                <th>Last seen</th>
                <th>Pitch / contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, mine }) => {
                const full = c.avgPerRating7d * c.cardRating;
                const tp = targetPrice(full, discount);
                return (
                  <tr key={`${c.bidderUsername}-${c.playerName}`} className={mine ? 'bg-emerald/5' : ''}>
                    <td className="num text-xs">{c.bidderUsername}</td>
                    <td>
                      <span className="font-medium">{c.playerName}</span> <span className="chip-muted">{c.sport}</span>
                      {mine && <span className="chip-emerald ml-1">you own ×{mine.total}</span>}
                    </td>
                    <td className="r num">
                      <span className={c.rarity === 'Mystic' ? 'text-amber' : 'text-action'}>{c.rarity}</span>
                      {c.copiesOwned > 0 && <span className="text-muted"> ×{c.copiesOwned}</span>}
                    </td>
                    <td className="r num">
                      {score(c)} <span className="text-[11px] text-muted">({c.bids7d}b · {c.buys7d}buy)</span>
                    </td>
                    <td className="r num">{dec(c.avgPerRating7d, 2)}/1</td>
                    <td className="r num font-semibold text-emerald">{rax(tp)}</td>
                    <td className="num text-xs text-muted">{ago(c.lastActivityAt)}</td>
                    <td>
                      <span className="inline-flex flex-wrap gap-1.5">
                        <CopyButton text={buildContenderPitch({ playerName: c.playerName, targetPrice: tp, cardRating: c.cardRating })} label="Pitch" toast="Pitch copied" disabled={!mine && haveCollection} />
                        <DirectDMLink username={c.bidderUsername} userId={c.bidderUserId} compact />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        Example: someone holding Jaxon Smith-Njigba at Mystic ×4 who has bid and bought JSN repeatedly this week is likelier to pay up. "Ask at your card" prices your card at their own 7-day average per-rating × the card's rating, then applies the slider. "Close" is a count of copies held — Real's exact upgrade thresholds aren't known to this tool.
        {haveCollection ? '' : ' Enter your username above to see which contenders want a card you own.'}
      </div>
    </div>
  );
}
