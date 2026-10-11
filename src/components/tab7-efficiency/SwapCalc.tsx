import { useMemo, useState } from 'react';
import { DEFAULT_PRICE_PARAMS, packEconomics, swapCost } from '../../../shared/otdPricing';
import { packResaleView, type PackIndex, type PackStats } from '../../../shared/raxedgePackOdds';
import { dec, rax } from '../../lib/format';
import { Explain } from '../ui/Explain';
import type { EffState } from './model';

const n = (v: string) => Math.max(0, +v.replace(/[^\d.]/g, '') || 0);

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted">{label}
      <input className="field num !w-24" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(n(e.target.value))} />
    </label>
  );
}

const ageText = (at: number | null) => {
  if (!at) return 'age unknown';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 90 ? `${Math.max(1, m)} min old` : m < 2880 ? `${Math.round(m / 60)} h old` : `${Math.round(m / 1440)} d old`;
};

/**
 * OPTIONAL (only when RaxEdge pack odds are imported): what one Player pack for a chosen player-season is expected to add
 * in rating, and what that implies per rating point. The resale line is an ESTIMATE using a standing-bid rate.
 */
function PackRatingPanel({ pack, packAt, defaultPack, defaultRate, feePct }: { pack: PackIndex; packAt: number | null; defaultPack: number; defaultRate: number; feePct: number }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [price, setPrice] = useState(defaultPack);
  const [mkt, setMkt] = useState(defaultRate);
  const all = useMemo(() => [...pack.values()].sort((a, b) => a.name.localeCompare(b.name) || b.season.localeCompare(a.season)), [pack]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? all.filter((x) => x.name.toLowerCase().includes(t)) : all).slice(0, 60);
  }, [all, q]);
  const keyOf = (x: PackStats) => `${x.sport}|${x.season}|${x.id}`;
  const st = all.find((x) => keyOf(x) === sel) ?? matches[0];
  const r = st ? packResaleView(st, { packPrice: price, marketRate: mkt, fee: feePct / 100 }) : null;
  return (
    <div className="panel">
      <div className="panel-hd flex-wrap"><h2>Expected rating per pack</h2><span className="chip-blue">from your RaxEdge import · {all.length.toLocaleString()} rows · {ageText(packAt)}</span></div>
      <div className="panel-bd space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input className="field !w-40" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pack-odds player" />
          <select className="field !w-64 max-w-full" value={st ? keyOf(st) : ''} onChange={(e) => setSel(e.target.value)} aria-label="Player season">
            {matches.map((x) => <option key={keyOf(x)} value={keyOf(x)}>{x.name} · {x.sport.toUpperCase()} {x.season} · {x.position}</option>)}
          </select>
        </div>
        {st && r ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted">Average card rating</span><span className="num">{dec(st.avgCardValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Expected rating per pack (× 3)</span><span className="num font-semibold text-emerald">{dec(st.expectedRatingPerPack)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Tier odds</span><span className="num">legendary {dec(st.tierOdds.legendary, 0)}% · epic {dec(st.tierOdds.epic, 0)}% · rare {dec(st.tierOdds.rare, 0)}%</span></div>
                <div className="flex justify-between"><span className="text-muted">Cards sampled</span><span className={`num ${st.sample < 5 ? 'text-amber' : ''}`}>{st.sample}{st.sample < 5 ? ' (small sample)' : ''}</span></div>
              </div>
              <div className="space-y-1 text-sm">
                <Field label="Pack price" value={price} onChange={setPrice} />
                <Field label="Resale rate (Rax/rating)" value={mkt} onChange={setMkt} step={0.5} />
                <div className="flex justify-between"><span className="text-muted">Implied Rax per rating (keep cards)</span><span className="num font-semibold">{dec(r.grossRate, 1)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Estimate: net cost per rating if you resell</span><span className="num">{dec(r.netCostPerRating, 1)}</span></div>
              </div>
            </div>
            <p className="hint">Keep-the-cards figure = pack price ÷ expected rating. Resale estimate: selling the pulled cards at {dec(mkt, 1)} Rax/rating (a standing-bid rate, not an observed sale) less the {feePct.toFixed(0)}% fee recovers ≈ {rax(r.recovered)}, a net pack cost of ≈ {rax(r.netPackCost)}. That is the spread lost on a round trip, not the cost of owning rating. Pulls are random; booster cards ignored.</p>
          </>
        ) : <p className="hint">No rows match.</p>}
      </div>
    </div>
  );
}

/** Pack swap and "N back" calculators, from the Rax Academy posts. Both are normally Pro-only. */
export default function SwapCalc({ packOdds, packAt, s }: { packOdds?: PackIndex; packAt?: number | null; s?: Pick<EffState, 'packPrice' | 'rate'> }) {
  const pp = DEFAULT_PRICE_PARAMS;
  const [pack, setPack] = useState(pp.pack.swapPackPrice.value);
  const [sent, setSent] = useState(410);
  const [recv, setRecv] = useState(410);
  const [fee, setFee] = useState(pp.marketFee.value * 100);
  const [direct, setDirect] = useState(pp.pack.playerPackPrice.value);
  const [booster, setBooster] = useState(0);
  const [cbPack, setCbPack] = useState(pp.pack.playerPackPrice.value);
  const [back, setBack] = useState(160);
  const swap = useMemo(() => swapCost({ kind: 'pack-swap', packPrice: pack, offerSent: sent, offerReceived: recv, fee: fee / 100, boosterValue: booster, comparePackPrice: direct }), [pack, sent, recv, fee, booster, direct]);
  const cash = useMemo(() => swapCost({ kind: 'cash-back', packPrice: cbPack, cashBack: back, fee: fee / 100, boosterValue: booster, comparePackPrice: direct }), [cbPack, back, fee, booster, direct]);
  const eco = useMemo(() => packEconomics(pp), [pp]);

  const Rows = ({ r }: { r: typeof swap }) => (
    <table className="tbl">
      <thead><tr><th>Step</th><th className="r">Rax</th><th className="r">Balance</th></tr></thead>
      <tbody>
        {r.rows.map((x, i) => (
          <tr key={i}><td>{x.label}{x.note && <div className="text-[11px] text-muted">{x.note}</div>}</td><td className={`r num ${x.amount < 0 ? 'text-danger' : 'text-emerald'}`}>{x.amount > 0 ? '+' : ''}{rax(x.amount)}</td><td className="r num text-muted">{rax(x.balance)}</td></tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <Explain title="What swaps are (and why they work)" defaultOpen>
        <p><b className="text-head">Pack swap.</b> You buy a pack for a player; a partner buys a pack for a different player. Each of you then offers the lowest allowed price (≈410–420) on the <i>other's</i> pack's cards. When you send the offer you are down pack + offer; when theirs is accepted you get it back minus the 10% marketplace fee. Net cost ≈ pack + fee × offer — about <b className="text-head">241</b> for a pack that otherwise costs 271, <i>and</i> you keep the booster.</p>
        <p><b className="text-head">"N back."</b> You buy a pack for the player someone is grinding; they offer a high price on the 3 cards you pulled (above their normal rating-based value) and send some Rax back (e.g. 160). You net a cheaper pack and a booster; they get the rating they need for a card they are levelling.</p>
        <p className="text-[11px]">Source: Rax Academy "Pack swap | 160 back" post — community-described, normally Pro-only. The fee (10%) is read from that post's arithmetic, not from Real's docs. How the "160" decomposes is ambiguous; the cash-back model below treats it as a flat rebate.</p>
      </Explain>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-hd"><h2>Pack swap</h2><span className="num text-sm font-semibold text-emerald">{swap.netCost >= 0 ? 'cost' : 'gain'} {rax(Math.abs(swap.netCost))}</span></div>
          <div className="panel-bd space-y-2">
            <Field label="Your pack price" value={pack} onChange={setPack} />
            <Field label="Offer you send" value={sent} onChange={setSent} />
            <Field label="Offer you receive" value={recv} onChange={setRecv} />
            <Rows r={swap} />
            <p className="hint">{swap.summary}</p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd"><h2>"N back"</h2><span className="num text-sm font-semibold text-emerald">{cash.netCost >= 0 ? 'cost' : 'gain'} {rax(Math.abs(cash.netCost))}</span></div>
          <div className="panel-bd space-y-2">
            <Field label="Pack price" value={cbPack} onChange={setCbPack} />
            <Field label="Rax sent back" value={back} onChange={setBack} />
            <Rows r={cash} />
            <p className="hint">{cash.summary}</p>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd"><h2>Shared assumptions</h2></div>
        <div className="panel-bd grid gap-2 sm:grid-cols-3">
          <Field label="Marketplace fee %" value={fee} onChange={setFee} step={1} />
          <Field label="Buying a pack outright" value={direct} onChange={setDirect} />
          <Field label="Booster value (your guess)" value={booster} onChange={setBooster} />
        </div>
        <p className="hint px-3 pb-3">Pack economics: {eco.explanation}</p>
      </div>
      {packOdds && packOdds.size > 0 && <PackRatingPanel pack={packOdds} packAt={packAt ?? null} defaultPack={s?.packPrice ?? pp.pack.playerPackPrice.value} defaultRate={s?.rate ?? pp.ratePerRating.mid.value} feePct={fee} />}
    </div>
  );
}
