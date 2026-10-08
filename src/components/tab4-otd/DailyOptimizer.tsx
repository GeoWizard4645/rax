import { useMemo, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { RARITIES, SPORTS } from '../../../shared/formulas';
import { CLAIMS_PER_SPORT_PER_DAY, planDay, type OwnedCard, type SportMult } from '../../../shared/otd';
import type { HistoricalGame, Rarity, Sport } from '../../types/real';
import { load, save } from '../../lib/storage';
import { dec, rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';
import { useToast } from '../ui/Toast';
import { useCardGames, useRaxNameSearch, useRaxSeasons } from '../../hooks/useRax';

const KEY = 'rax_otd_owned_v1';

function parseOwned(text: string): { cards: OwnedCard[]; errors: string[] } {
  const cards: OwnedCard[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [player, sport, season, rarity] = line.split(',').map((s) => s.trim());
    const sp = sport?.toUpperCase() as Sport;
    const ra = RARITIES.find((r) => r.toLowerCase() === rarity?.toLowerCase());
    if (!player || !SPORTS.includes(sp) || !season || !ra) errors.push(`Line ${i + 1}: expected "Player, Sport, Season, Rarity".`);
    else cards.push({ playerName: player, sport: sp, season, rarity: ra });
  });
  return { cards, errors };
}

/** 2-Claim Daily Optimizer: today's payout per owned past-season card; the top 2 per sport are flagged. */
export default function DailyOptimizer({ games: dayGames, md, sportMult, live = false }: { games: HistoricalGame[]; md: string; sportMult: SportMult; live?: boolean }) {
  const notify = useToast();
  const [owned, setOwned] = useState<OwnedCard[]>(() => load<OwnedCard[]>(KEY, []));
  const [paste, setPaste] = useState('');
  const [sport, setSport] = useState<Sport>('NFL');
  const [player, setPlayer] = useState('');
  const [season, setSeason] = useState('');
  const [rarity, setRarity] = useState<Rarity>('Common');

  const persist = (c: OwnedCard[]) => (setOwned(c), save(KEY, c));
  // Live: today's top games may not include every owned card, so each owned card's own calendar is loaded too.
  const ownedGames = useCardGames(owned, live);
  const games = useMemo(() => {
    if (!live || !ownedGames.data?.length) return dayGames;
    const seen = new Set(dayGames.map((g) => g.id));
    return [...dayGames, ...ownedGames.data.filter((g) => !seen.has(g.id))];
  }, [live, dayGames, ownedGames.data]);
  const raxSeasons = useRaxSeasons(live);
  const suggested = useRaxNameSearch(sport, player, live);
  const players = useMemo(() => (live ? suggested : [...new Set(games.filter((g) => g.sport === sport).map((g) => g.playerName))].sort()), [live, suggested, games, sport]);
  const seasons = useMemo(
    () => (live ? raxSeasons.bySport[sport] ?? [] : [...new Set(games.filter((g) => g.sport === sport && g.playerName.toLowerCase() === player.trim().toLowerCase()).map((g) => g.season))].sort().reverse()),
    [live, raxSeasons.bySport, games, sport, player],
  );
  const plan = useMemo(() => planDay(owned, games, md, sportMult), [owned, games, md, sportMult]);
  const sportsWithRows = SPORTS.filter((s) => plan.bySport[s]?.length);
  const dup = (c: OwnedCard) => owned.some((o) => o.sport === c.sport && o.season === c.season && o.playerName.toLowerCase() === c.playerName.toLowerCase());

  const addOne = () => {
    const c: OwnedCard = { playerName: player.trim(), sport, season: season || seasons[0] || '', rarity };
    if (!c.playerName || !c.season) return notify('Pick a player and season.', 'error');
    if (dup(c)) return notify('You already added that card.', 'error');
    persist([...owned, c]);
    setPlayer('');
    setSeason('');
  };
  const addPaste = () => {
    const r = parseOwned(paste);
    if (r.errors.length) notify(r.errors[0], 'error');
    const fresh = r.cards.filter((c) => !dup(c));
    if (fresh.length) {
      persist([...owned, ...fresh]);
      setPaste('');
      notify(`Added ${fresh.length} card${fresh.length === 1 ? '' : 's'}.`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="panel">
          <div className="panel-hd"><h2>Your past-season cards <span className="num text-xs font-normal text-muted">({owned.length})</span></h2></div>
          <div className="panel-bd space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="o-sport">Sport</label>
                <select id="o-sport" className="field" value={sport} onChange={(e) => (setSport(e.target.value as Sport), setPlayer(''), setSeason(''))}>
                  {SPORTS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="o-rar">Rarity</label>
                <select id="o-rar" className="field" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
                  {RARITIES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="o-player">Player</label>
                <input id="o-player" className="field" list="otd-players" value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Start typing…" autoComplete="off" />
                <datalist id="otd-players">{players.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label className="label" htmlFor="o-season">Season</label>
                <select id="o-season" className="field" value={season || seasons[0] || ''} onChange={(e) => setSeason(e.target.value)} disabled={!seasons.length}>
                  {seasons.length ? seasons.map((s) => <option key={s}>{s}</option>) : <option value="">—</option>}
                </select>
              </div>
            </div>
            <button className="btn-primary w-full" onClick={addOne}><Plus size={14} /> Add card</button>
            <div>
              <label className="label" htmlFor="o-paste">…or paste a list (Player, Sport, Season, Rarity)</label>
              <textarea id="o-paste" className="field num min-h-[84px]" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Josh Allen, NFL, 2020, Epic\nNikola Jokic, NBA, 2022, Mystic'} />
              <button className="btn-ghost btn-sm mt-1.5" onClick={addPaste} disabled={!paste.trim()}>Add pasted cards</button>
            </div>
            {owned.length > 0 && (
              <div className="max-h-52 overflow-auto rounded-md border border-line">
                {owned.map((c, i) => (
                  <div key={`${c.sport}-${c.playerName}-${c.season}`} className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-1.5 text-sm last:border-b-0">
                    <span>{c.playerName} <span className="chip-muted">{c.sport}</span> <span className="num text-xs text-muted">{c.season} · {c.rarity}</span></span>
                    <button className="btn-ghost btn-sm" aria-label={`Remove ${c.playerName}`} onClick={() => persist(owned.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="hint">Stored only in this browser. A card only pays out on the days its original games happened.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Claimable today" value={rax(plan.claimableTotal)} sub={`top ${CLAIMS_PER_SPORT_PER_DAY} per sport`} tone="emerald" />
            <Stat label="Would be wasted" value={rax(plan.leftOnTable)} sub="outside the top 2" tone="amber" />
            <Stat label="Cards paying" value={String(Object.values(plan.bySport).reduce((n, l) => n + (l?.length ?? 0), 0))} sub={`on ${md}`} />
          </div>
          {sportsWithRows.length === 0 ? (
            <div className="panel"><Empty title={owned.length ? `None of your cards have a game on ${md}` : 'Add your past-season cards'}>{owned.length ? 'Try another date in the catalog above.' : 'The optimizer shows which of your cards pay today and which two to claim per sport.'}</Empty></div>
          ) : (
            sportsWithRows.map((s) => (
              <div key={s} className="panel overflow-hidden">
                <div className="panel-hd"><h2>{s}</h2><span className="text-xs text-muted">claim the top {CLAIMS_PER_SPORT_PER_DAY}</span></div>
                <table className="tbl">
                  <thead><tr><th>Claim</th><th>Card</th><th className="r">Game</th><th className="r">Base</th><th className="r">Final yield</th></tr></thead>
                  <tbody>
                    {plan.bySport[s]!.map((r) => (
                      <tr key={r.game.id} className={r.claim ? '' : 'opacity-60'}>
                        <td>{r.claim ? <span className="chip-emerald"><Check size={11} /> CLAIM</span> : <span className="chip-muted"><X size={11} /> skip</span>}</td>
                        <td><span className="font-medium">{r.card.playerName}</span> <span className="num text-xs text-muted">{r.card.season} · {r.card.rarity}</span></td>
                        <td className="r num text-muted">{r.game.date.slice(0, 4)} · {dec(r.game.rating, 1)}</td>
                        <td className="r num">{rax(r.game.baseRax)}</td>
                        <td className={`r num font-semibold ${r.claim ? 'text-emerald' : ''}`}>{rax(r.yieldRax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
