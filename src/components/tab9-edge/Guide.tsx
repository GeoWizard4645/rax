import { useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { americanToImplied, devig2 } from '../../../shared/odds';
import { evalSide, fmtNum, fmtSigned, parsePct, type Cfg } from './edgeLogic';
import { NumInput } from './fields';

export interface GuideExample {
  /** e.g. "Seattle moneyline" */
  label: string;
  /** Consensus fair probability (0–1) from a live row. */
  fair: number;
}

const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <li className="flex gap-3">
    <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-action/50 bg-action/10 text-xs font-semibold text-action">{n}</span>
    <div className="min-w-0">
      <div className="text-sm font-medium text-head">{title}</div>
      <div className="mt-0.5 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  </li>
);

const B = ({ children }: { children: ReactNode }) => <b className="text-head">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="num text-head">{children}</span>;

/** “Try it” — fair %, Real %, rake → EV, edge, break-even, stake. Needs no live game. */
function TryIt({ cfg, seed }: { cfg: Cfg; seed: GuideExample | null }) {
  const [fair, setFair] = useState<number | null>(seed ? Math.round(seed.fair * 1000) / 10 : 60);
  const [real, setReal] = useState<number | null>(seed ? Math.max(1, Math.round(seed.fair * 100) - 6) : 52);
  const [rake, setRake] = useState<number | null>(+(cfg.rules.rake * 100).toFixed(2));
  const rules = { ...cfg.rules, rake: Math.min(0.5, (rake ?? 0) / 100) };
  const r = fair != null && real != null ? evalSide(fair / 100, real, { ...cfg, rules }) : null;
  const pctOnly = (t: string) => parsePct(t);
  return (
    <div className="rounded-md border border-action/30 bg-action/5 p-3">
      <div className="mb-2 text-sm font-medium text-head">Try it — no live game needed</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">Fair % (no-vig)<NumInput label="Try it: fair percent" value={fair} parse={pctOnly} onCommit={setFair} suffix="%" className="mt-1 block w-28" /></label>
        <label className="text-xs text-muted">Real shows<NumInput label="Try it: Real percent" value={real} parse={pctOnly} onCommit={setReal} suffix="%" className="mt-1 block w-28" /></label>
        <label className="text-xs text-muted">Rake (assumed)<NumInput label="Try it: rake percent" value={rake} parse={(t) => { const v = t.trim().replace(',', '.'); return v === '' ? null : /^\d+(\.\d+)?$/.test(v) && +v <= 50 ? +v : 'invalid'; }} onCommit={setRake} suffix="%" className="mt-1 block w-28" /></label>
      </div>
      {r ? (
        <div className="num mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>Payout multiple <b className="text-head">×{r.multiple.toFixed(3)}</b> <span className="text-xs text-muted">= 1 ÷ {fmtNum(real, 1)}% × (1 − {fmtNum(rules.rake * 100, 1)}%)</span></div>
          <div>EV <b className={r.ev > 0 ? 'text-emerald' : 'text-danger'}>{fmtSigned(r.ev, 2, '%')}</b> <span className="text-xs text-muted">= {fmtNum(fair, 1)}% × {r.multiple.toFixed(3)} − 1</span></div>
          <div>Edge <b className={r.edgePp > 0 ? 'text-emerald' : 'text-danger'}>{fmtSigned(r.edgePp, 1, ' pp')}</b></div>
          <div>Break-even Real % <b className="text-head">≤ {fmtNum(r.breakEven, 1)}%</b></div>
          <div>Rake it survives <b className="text-head">{r.maxRake >= 0 ? `up to ${fmtNum(r.maxRake * 100, 1)}%` : 'none — loses even at 0%'}</b></div>
          <div>
            {(cfg.fraction * 100).toFixed(0) === '25' ? '¼' : `${(cfg.fraction * 100).toFixed(1)}%`} Kelly stake <b className="text-head">{cfg.bankroll > 0 ? `${r.stake.toLocaleString('en-US')} Rax` : 'set a bankroll'}</b>{' '}
            <span className="text-xs text-muted">of {cfg.bankroll.toLocaleString('en-US')}</span>
          </div>
        </div>
      ) : (
        <p className="hint mt-2">Enter a fair % and the % Real shows (0.5–99.5).</p>
      )}
    </div>
  );
}

/** Beginner guide at the top of the page — open by default, collapsible. */
export default function Guide({ cfg, example }: { cfg: Cfg; example: GuideExample | null }) {
  const [open, setOpen] = useState(true);
  const dk = useMemo(() => {
    const a = americanToImplied(-150);
    const b = americanToImplied(130);
    const [fa, fb] = devig2(a, b);
    return { a, b, fa, fb };
  }, []);
  const ex = useMemo(() => {
    const fair = example?.fair ?? 0.6;
    const real = Math.max(1, Math.round(fair * 100) - 6);
    const r = evalSide(fair, real, cfg);
    return { fair, real, r, label: example?.label ?? 'a team', live: !!example };
  }, [example, cfg]);
  const kelly = ex.r ? ex.r.kelly : 0;

  return (
    <div className="panel">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <BookOpen size={15} className="text-action" />
        <span className="flex-1">How to find +EV bets with this tool — a beginner’s guide</span>
        <ChevronDown size={15} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-3 py-3">
          <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-relaxed text-amber/90">
            <b>Not financial advice.</b> This is a calculator. It compares Real’s prediction percentages (which <i>you</i> type in — Real’s market can’t be read automatically and predictions are a Real Pro feature) with free outside prices. <b>EV is only as good as the Real % you type and the rake assumption.</b> Real’s fees are not published; the 5% default is a placeholder. A +EV bet still loses often.
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 text-sm leading-relaxed text-muted">
              <div>
                <div className="text-sm font-semibold text-head">The idea in three sentences</div>
                <p>Sportsbooks and exchanges (Kalshi, Polymarket) are very good at pricing games. Real’s market is set by its own community, so its percentages are sometimes off. If Real shows a side at a <i>lower</i> % than the outside “fair” probability, you are paid more than the risk deserves — that gap is your edge.</p>
              </div>
              <div>
                <div className="text-sm font-semibold text-head">1 · What is a no-vig fair probability?</div>
                <p>
                  A sportsbook’s two prices add up to more than 100% — the extra is its fee (the <B>vig</B>). Example: DraftKings −150 / +130 means <M>{(dk.a * 100).toFixed(1)}%</M> and <M>{(dk.b * 100).toFixed(1)}%</M> = <M>{((dk.a + dk.b) * 100).toFixed(1)}%</M>. Divide each by the total and you get the <B>fair probability</B>: <M>{(dk.fa * 100).toFixed(1)}%</M> / <M>{(dk.fb * 100).toFixed(1)}%</M>. Kalshi and Polymarket prices are already probabilities (no vig), so they are only re-normalised. The tool shows each source’s fair % and a weighted <B>consensus</B> (better-traded, tighter markets count more).
                </p>
              </div>
              <div>
                <div className="text-sm font-semibold text-head">2 · What does Real’s % mean?</div>
                <p>Real says the % is the community’s implied likelihood and that <B>lower percentages pay more Rax</B>. Think of a share priced at the shown % that pays 1 if you win: staking 1 Rax at 40% returns about 1 ÷ 0.40 = 2.5 Rax; at 60% about 1.67. Real also takes some fee (rake) that it does not publish — editable under “Real payout rules”.</p>
              </div>
              <div>
                <div className="text-sm font-semibold text-head">3 · Reading EV% and edge</div>
                <p>
                  <B>EV% = fair probability × payout multiple − 1</B>, where multiple = (1 ÷ Real %) × (1 − rake). <B>Edge</B> = fair % − Real % in percentage points. Worked example{ex.live ? ' from a live row' : ''}: the consensus gives <B>{ex.label}</B> <M>{(ex.fair * 100).toFixed(1)}%</M>. Suppose Real shows <M>{ex.real}%</M>. Multiple = 1 ÷ {(ex.real / 100).toFixed(2)} × (1 − {(cfg.rules.rake * 100).toFixed(0)}%) = <M>{ex.r ? ex.r.multiple.toFixed(3) : '—'}</M>, so EV = {(ex.fair * 100).toFixed(1)}% × {ex.r ? ex.r.multiple.toFixed(3) : '—'} − 1 = <M>{ex.r ? fmtSigned(ex.r.ev, 1, '%') : '—'}</M> and edge = <M>{ex.r ? fmtSigned(ex.r.edgePp, 1, ' pp') : '—'}</M>. An EV of {ex.r ? fmtSigned(ex.r.ev, 0, '%') : '+x%'} means: on average, every 100 Rax staked comes back as {ex.r ? Math.round(100 + ex.r.ev) : '1xx'} over many bets — not that this one bet wins.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-head">The routine</div>
                <ol className="mt-2 space-y-3">
                  <Step n={1} title="Pick a sport, open a game">Choose a sport tab, then click a market row (Moneyline / Spread / Total). Rows show Kalshi, Polymarket and DraftKings side by side.</Step>
                  <Step n={2} title="Type what Real shows, for each side">Open the same game in Real and copy the % into the two boxes. The tool gives EV, edge, break-even % and a stake straight away.</Step>
                  <Step n={3} title="Look for EV > 0 and sources that agree">A green “sources agree” (within 3 pp) means the fair % is trustworthy. If sources are 5+ pp apart one quote is stale or thin — treat the EV as unreliable. One-source games have nothing to cross-check.</Step>
                  <Step n={4} title="Size it with fractional Kelly">Kelly gives the stake that grows a bankroll fastest <i>if your edge is exactly right</i> — here it is about <M>{(kelly * 100).toFixed(1)}%</M> of bankroll for the example. Since fair odds are noisy, bet a fraction: ¼ Kelly keeps most of the growth with far smaller swings. Set the max-stake cap as a hard ceiling, and keep bankroll = money you can lose.</Step>
                  <Step n={5} title="Re-check as the pool fills">Real’s % moves during the day. The sensitivity table shows EV as the % shifts (and the break-even %) — if it moves past break-even the bet is gone. Re-check just before you place it.</Step>
                  <Step n={6} title="Don’t chase">A +EV bet loses a lot (a 60% side loses 4 times in 10). Stick to your sizing after losses, and don’t raise stakes to “win it back”.</Step>
                </ol>
              </div>
            </div>
          </div>

          <TryIt cfg={cfg} seed={example} />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-semibold text-head">Common mistakes</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
                <li>Typing the wrong side’s % (home vs away), or Real’s % for a different line (spread −3.5 vs −4.5, total 47.5 vs 48.5). Check the line chip.</li>
                <li>Trusting a big EV from one thin source. If Kalshi/Polymarket show tiny volume or a wide bid-ask, the “fair” % is a resting quote, not a market.</li>
                <li>Treating the 5% rake as fact. Measure it (Real payout rules → calibrator); at the wrong rake every EV is off by about that much.</li>
                <li>Full Kelly, or staking more than the cap, on a noisy edge. Over-betting is the fastest way to lose a bankroll with a real edge.</li>
                <li>Ignoring that totals and spreads on Real may have different lines or no market at all, and that in-play lines move fast.</li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold text-head">Glossary</div>
              <dl className="mt-1 space-y-1 text-sm leading-relaxed text-muted">
                <div><dt className="inline text-head">Vig · </dt><dd className="inline">the bookmaker’s built-in fee: its two prices sum to more than 100%.</dd></div>
                <div><dt className="inline text-head">Fair probability · </dt><dd className="inline">a price with the vig removed — the best outside estimate of the true chance.</dd></div>
                <div><dt className="inline text-head">EV · </dt><dd className="inline">expected profit as % of stake over many identical bets; edge · fair % − Real %, in points.</dd></div>
                <div><dt className="inline text-head">Kelly · </dt><dd className="inline">the stake fraction that maximises long-run growth; “¼ Kelly” bets a quarter of that.</dd></div>
              </dl>
              <div className="mt-3 text-sm font-semibold text-head">Limits to keep in mind</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
                <li>Exchange liquidity: a Kalshi/Polymarket price with little volume is weak evidence; the consensus down-weights it (see the vol column).</li>
                <li>Soccer moneylines are 3-way (home / draw / away, 90 minutes). If Real has no draw option, use “Draw no bet” in the editor.</li>
                <li>Start times marked “≈” are approximate (only the date is known) — confirm kick-off before relying on a line.</li>
                <li>DraftKings (via ESPN) appears only about a day ahead; FanDuel is not available (no public API).</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

