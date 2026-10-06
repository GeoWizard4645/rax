import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { RARITIES } from '../../../shared/formulas';
import { cardRoi, compareCards, type CardRoi, type SportMult } from '../../../shared/otd';
import type { HistoricalGame, Rarity } from '../../types/real';
import { dec, rax } from '../../lib/format';

const label = (c: CardRoi) => `${c.playerName} — ${c.sport} ${c.season}`;

/** Side-by-side comparison of two historical cards. */
export default function CompareTool({ games, md, sportMult }: { games: HistoricalGame[]; md: string; sportMult: SportMult }) {
  const [rarity, setRarity] = useState<Rarity>('Epic');
  const [qa, setQa] = useState('');
  const [qb, setQb] = useState('');
  const cards = useMemo(() => cardRoi(games, rarity, md, sportMult), [games, rarity, md, sportMult]);
  const byLabel = useMemo(() => new Map(cards.map((c) => [label(c), c])), [cards]);
  const a = byLabel.get(qa), b = byLabel.get(qb);
  const cmp = a && b ? compareCards(a, b) : null;
  const options = useMemo(() => [...cards].sort((x, y) => y.annualYield - x.annualYield).slice(0, 1500).map(label), [cards]);

  const Row = ({ name, va, vb, w, fmt }: { name: string; va: number; vb: number; w: 'a' | 'b' | 'tie'; fmt: (n: number) => string }) => (
    <tr>
      <td className="text-muted">{name}</td>
      <td className={`r num ${w === 'a' ? 'font-semibold text-emerald' : ''}`}>{w === 'a' && <Trophy size={11} className="mr-1 inline" />}{fmt(va)}</td>
      <td className={`r num ${w === 'b' ? 'font-semibold text-emerald' : ''}`}>{w === 'b' && <Trophy size={11} className="mr-1 inline" />}{fmt(vb)}</td>
    </tr>
  );

  return (
    <div className="panel">
      <div className="panel-hd flex-wrap">
        <h2>Side-by-side comparison</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted">At rarity
          <select className="field !w-auto" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>{RARITIES.map((r) => <option key={r}>{r}</option>)}</select>
        </label>
      </div>
      <div className="panel-bd space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {([['Card A', qa, setQa, a], ['Card B', qb, setQb, b]] as const).map(([name, v, set, sel]) => (
            <div key={name}>
              <label className="label">{name}</label>
              <input className="field" list="cmp-cards" value={v} onChange={(e) => set(e.target.value)} placeholder="Search a player…" autoComplete="off" aria-invalid={!!v && !sel} />
            </div>
          ))}
          <datalist id="cmp-cards">{options.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
        {cmp ? (
          <table className="tbl">
            <thead><tr><th /><th className="r">{cmp.a.playerName} <span className="num font-normal">{cmp.a.season}</span></th><th className="r">{cmp.b.playerName} <span className="num font-normal">{cmp.b.season}</span></th></tr></thead>
            <tbody>
              <Row name="Games (anniversaries / yr)" va={cmp.a.games} vb={cmp.b.games} w={cmp.winners.games} fmt={String} />
              <Row name="Median yield / game" va={cmp.a.medianGame} vb={cmp.b.medianGame} w={cmp.winners.median} fmt={rax} />
              <Row name="Max single-game ceiling" va={cmp.a.maxGame} vb={cmp.b.maxGame} w={cmp.winners.ceiling} fmt={rax} />
              <Row name="Total annual potential" va={cmp.a.annualYield} vb={cmp.b.annualYield} w={cmp.winners.annual} fmt={rax} />
              <tr><td className="text-muted">Left this year</td><td className="r num">{rax(cmp.a.remainingYield)}</td><td className="r num">{rax(cmp.b.remainingYield)}</td></tr>
              <tr><td className="text-muted">Annual per game</td><td className="r num text-muted">{dec(cmp.a.annualYield / Math.max(1, cmp.a.games), 0)}</td><td className="r num text-muted">{dec(cmp.b.annualYield / Math.max(1, cmp.b.games), 0)}</td></tr>
            </tbody>
          </table>
        ) : <p className="hint">Pick two cards from the suggestions to compare them.</p>}
      </div>
    </div>
  );
}
