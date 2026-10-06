/** Quads & poll analytics — Tab 6. Payout tiers are from the spec; thresholds are explicit constants. */
import type { Poll, PollOption, QuadGame } from './sample';

/** Quads payout reference — Rax per teammate. */
export const QUAD_PAYOUTS = [
  { tier: 'Top 50% finish', raxPerTeammate: 50 },
  { tier: 'Top 20% finish', raxPerTeammate: 100 },
  { tier: 'Top 10 squads', raxPerTeammate: 200 },
] as const;

export const SQUAD_SIZE = 4;
export const squadTotal = (raxPerTeammate: number) => raxPerTeammate * SQUAD_SIZE;

/** Karma opportunity = expected polls × pace index. Higher means more chances to grow a streak. */
export const karmaOpportunity = (g: Pick<QuadGame, 'pollsPerGame' | 'pace'>) =>
  Math.round(g.pollsPerGame * g.pace * 10) / 10;

export const CONSENSUS_PCT = 65;
export const CONTRARIAN_MAX_PCT = 30;
export const CONTRARIAN_MIN_PCT = 10;

export type PollKind = 'consensus' | 'lean' | 'split';

export interface PollRead {
  poll: Poll;
  leader: PollOption;
  kind: PollKind;
  /** A rarely-picked option that's still plausible (10–30%), or null. */
  contrarian: PollOption | null;
  /** Implied multiple if the contrarian option lands: 100 / pct. */
  contrarianMultiple: number | null;
}

export function readPoll(poll: Poll): PollRead {
  const sorted = [...poll.options].sort((a, b) => b.pct - a.pct);
  const leader = sorted[0];
  const kind: PollKind = leader.pct >= CONSENSUS_PCT ? 'consensus' : leader.pct >= 52 ? 'lean' : 'split';
  const contrarian = sorted.slice(1).find((o) => o.pct >= CONTRARIAN_MIN_PCT && o.pct <= CONTRARIAN_MAX_PCT) ?? null;
  return { poll, leader, kind, contrarian, contrarianMultiple: contrarian ? Math.round((100 / contrarian.pct) * 100) / 100 : null };
}
