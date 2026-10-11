import { useMemo, useState } from 'react';
import { DEFAULT_PRICE_PARAMS, packEconomics, swapCost } from '../../../shared/otdPricing';
import { rax } from '../../lib/format';
import { Explain } from '../ui/Explain';

const n = (v: string) => Math.max(0, +v.replace(/[^\d.]/g, '') || 0);

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted">{label}
      <input className="field num !w-24" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(n(e.target.value))} />
    </label>
  );
}

/** Pack swap and "N back" calculators, from the Rax Academy posts. Both are normally Pro-only. */
export default function SwapCalc() {
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
    </div>
  );
}
