/**
 * Static description of what the assistant may change on each tab: names, types, allowed values, plain-language meaning.
 * Kept apart from the components so the offline helper and the chat endpoint can reason about a tab that isn't mounted;
 * each tab binds getters/setters to these names with `useAgentSurface` (src/agent/useAgentSurface.ts).
 * Keep in step with docs/SITE-GUIDE.md — that is what the model reads about these parameters.
 */
import type { AgentActionSpec, AgentParamSpec } from '../../shared/agent/types';
import type { TabId } from '../../shared/agent/siteMap';
import { ICONIC_LEVELS, RARITY_LADDER } from '../../shared/otdRules';
import { OTD_SPORTS } from '../../shared/otdSnapshot';
import { ODDS_SPORTS } from '../../shared/odds';
import { RB_SPORTS } from '../../shared/rateboard';
import { SPORTS } from '../../shared/formulas';

export type ParamMeta = Omit<AgentParamSpec, 'value'>;

const RUNGS = [...RARITY_LADDER.filter((r) => r.otdEligible).map((r) => r.key), ...ICONIC_LEVELS.map((l) => l.key)];

/** Tab 7 and Tab 8 share one persisted state object (EffState), so they share these parameters. */
export const EFF_PARAMS: ParamMeta[] = [
  { name: 'method', type: 'enum', values: ['observed', 'modeled'], description: 'dataset: observed (Real per-game Rax via Rateboard, exact, top cards) or modeled (ESPN-stat estimate)' },
  { name: 'timeframe', type: 'enum', values: ['7', '30', '90', '180', '365', '5y', '10y', 'custom'], description: 'window the earnings cover, in days (or 5y/10y)' },
  { name: 'customDays', type: 'integer', min: 1, max: 365, description: 'days in the window when timeframe is custom' },
  { name: 'startDate', type: 'date', description: 'window start, YYYY-MM-DD; "today" or empty = today' },
  { name: 'capLifetime', type: 'boolean', description: '5y/10y views: true = a card’s cap is a lifetime total; false (default) = it resets yearly' },
  { name: 'proBonusWinPct', type: 'number', min: 0, max: 100, description: 'Pro bonus claim: assumed poll win probability in %, 0 ignores the bonus' },
  { name: 'rarity', type: 'enum', values: ['AUTO', ...RUNGS], description: 'level every card is held at (Iconic = Iconic 1); AUTO = fastest payback per card' },
  { name: 'autoMinRarity', type: 'enum', values: RARITY_LADDER.filter((r) => r.otdEligible).map((r) => r.key), description: 'in AUTO mode never go below this rarity' },
  { name: 'multiplierOverride', type: 'number', min: 0, description: 'override the multiplier of a fixed rarity; 0 = Real’s' },
  { name: 'sports', type: 'string[]', values: [...OTD_SPORTS], description: 'sports counted; empty list = all' },
  { name: 'budget', type: 'number', min: 0, description: 'Rax to spend in the best combination' },
  { name: 'maxCards', type: 'integer', min: 1, max: 60, description: 'how many cards the best combination may hold' },
  { name: 'minReturnPct', type: 'number', min: 0, description: 'skip cards earning less than this % of their cost inside the window' },
  { name: 'hold', type: 'enum', values: ['keep', 'flip'], description: 'keep the cards, or sell at the end of the window' },
  { name: 'flipLossPct', type: 'number', min: 0, max: 100, description: '% of price lost on resale when hold=flip' },
  { name: 'overlapMode', type: 'enum', values: ['earnings', 'min-overlap'], description: 'maximise claimable payout, or penalise payout your claim slots can’t take' },
  { name: 'ratePerRating', type: 'number', min: 1, description: 'Rax per rating point of play cards (price assumption; default 10)' },
];

export const PARAM_CATALOG: Record<TabId, ParamMeta[]> = {
  rateboard: [
    { name: 'sport', type: 'enum', values: Object.keys(RB_SPORTS), description: 'which sport’s offers to show (CFB, FC=soccer, NFL, UFC, NHL)' },
    { name: 'mode', type: 'enum', values: ['buy', 'sell'], description: 'buy = post/see buy offers; sell = match your collection to buyers' },
  ],
  scout: [
    { name: 'username', type: 'string', description: 'your Real username, used to pull your collection' },
    { name: 'view', type: 'enum', values: ['radar', 'scout', 'contenders'], description: 'Overpriced Radar, Proactive Scout or Repeat Contenders' },
    { name: 'discount', type: 'number', min: -30, max: 70, description: 'asking price vs their bid, in % (−30 = 30% over, 70 = 70% off)' },
  ],
  volatility: [
    { name: 'sport', type: 'enum', values: ['ALL', ...SPORTS], description: 'filter the screener by sport' },
    { name: 'player', type: 'string', description: 'select a player by (part of) name' },
  ],
  portfolio: [{ name: 'view', type: 'enum', values: ['audit', 'assets'], description: 'earnings audit or CDN asset downloader' }],
  quads: [
    { name: 'view', type: 'enum', values: ['matchups', 'squad'], description: 'matchups & polls, or the squad board' },
    { name: 'game', type: 'string', description: 'select a matchup by team name' },
  ],
  efficiency: [...EFF_PARAMS, { name: 'view', type: 'enum', values: ['rank', 'portfolio', 'mine', 'outlook', 'ladder', 'swaps'], description: 'open panel: card rankings, best combination, my cards, sports coming up, upgrade ladder, swaps & packs' }],
  calendar: [
    { name: 'month', type: 'integer', min: 1, max: 12, description: 'month shown' },
    { name: 'year', type: 'integer', min: 2026, max: 2040, description: 'year shown (this year and the 11 after)' },
    { name: 'claims', type: 'enum', values: ['2', '3'], description: 'claims per day: 2 guaranteed per sport, 3 adds Pro’s bonus' },
    { name: 'source', type: 'enum', values: ['mine', 'best'], description: 'calendar of cards you own, or of the optimizer’s best set' },
    ...EFF_PARAMS,
  ],
  edge: [
    { name: 'sport', type: 'enum', values: [...ODDS_SPORTS], description: 'sport whose games are listed' },
    { name: 'bankroll', type: 'number', min: 0, description: 'Rax that Kelly sizes against' },
    { name: 'kellyFraction', type: 'number', min: 0.01, max: 1, description: 'fraction of full Kelly (0.25 = quarter Kelly)' },
    { name: 'devig', type: 'enum', values: ['proportional', 'power'], description: 'how DraftKings vig is removed' },
    { name: 'rakePct', type: 'number', min: 0, max: 50, description: 'assumed Real fee in % (unknown; default 5)' },
    { name: 'rakeBasis', type: 'enum', values: ['payout', 'profit'], description: 'fee taken from the whole payout or only the profit' },
    { name: 'model', type: 'enum', values: ['fixed', 'pool'], description: 'fixed price, or pool (your stake moves the %)' },
    { name: 'poolRax', type: 'number', min: 0, description: 'market size in Rax for the pool model; 0 = unknown' },
    { name: 'minStake', type: 'number', min: 0, description: 'smallest stake in Rax; 0 = none' },
    { name: 'maxStake', type: 'number', min: 0, description: 'your cap per bet in Rax; 0 = none' },
    { name: 'view', type: 'enum', values: ['games', 'board'], description: 'Games list or the Best-EV board' },
  ],
};

export const ACTION_CATALOG: Partial<Record<TabId, AgentActionSpec[]>> = {
  scout: [
    { name: 'scout_my_cards', description: 'Pull the username’s collection (through Rateboard) and open Proactive Scout. Set username first.' },
    { name: 'refresh', description: 'Re-read the auction feed.' },
  ],
  rateboard: [{ name: 'refresh', description: 'Re-read the Rateboard offers.' }],
  edge: [{ name: 'refresh', description: 'Re-fetch the odds for the selected sport.' }],
  efficiency: [{ name: 'reset', description: 'Reset all Tab 7 parameters to their defaults (keeps the dataset choice).' }],
};
