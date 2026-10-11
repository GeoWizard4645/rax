/**
 * The site's tabs as the assistant and the MCP server describe them. One list, used by the chat prompt, the `navigate`
 * client tool, the `list_tabs` tool and the offline helper's intent matcher. Keep it in step with src/components/layout/TabNav.tsx.
 */
export type TabId = 'rateboard' | 'scout' | 'volatility' | 'portfolio' | 'quads' | 'efficiency' | 'calendar' | 'edge';

export interface SiteTab {
  /** Surface id: what `useAgentSurface` registers and what tools address. */
  id: TabId;
  /** The fixed tab number shown in the nav (there is no Tab 4). */
  n: number;
  route: string;
  label: string;
  summary: string;
  /** Extra words people use for it (offline intent matching). */
  aka: string[];
}

export const SITE_TABS: SiteTab[] = [
  { id: 'rateboard', n: 1, route: '/rateboard', label: 'Rateboard', summary: 'Live Rateboard offer board: browse/post buy offers, match your collection against buyers, copy-ready messages.', aka: ['rate board', 'offers', 'buy offers', 'sell cards', 'board'] },
  { id: 'scout', n: 2, route: '/scout', label: 'Scout', summary: 'Overpriced-auction radar, proactive scout (DMs to bidders on cards you own), repeat contenders.', aka: ['auction', 'auctions', 'radar', 'bidders', 'dm'] },
  { id: 'volatility', n: 3, route: '/volatility', label: 'Volatility', summary: 'Price spikes, fair-value scatter, candles and Monte Carlo projections (sample data).', aka: ['spikes', 'monte carlo', 'forecast', 'price history', 'candles'] },
  { id: 'portfolio', n: 5, route: '/portfolio', label: 'Portfolio', summary: 'Daily earnings audit (live vs OTD) and the CDN asset downloader.', aka: ['earnings', 'audit', 'assets', 'cdn', 'download'] },
  { id: 'quads', n: 6, route: '/quads', label: 'Quads', summary: 'Quad matchup pacing, polls, payout reference and squad board.', aka: ['quad', 'squad', 'polls', 'karma', 'matchups'] },
  { id: 'efficiency', n: 7, route: '/efficiency', label: 'OTD Efficiency', summary: 'Which cards/rarity earn the most On-This-Day Rax per Rax spent; best combination; upgrade ladder; swaps.', aka: ['otd', 'on this day', 'efficiency', 'optimizer', 'optimiser', 'best cards', 'ladder'] },
  { id: 'calendar', n: 8, route: '/calendar', label: 'OTD Calendar', summary: 'Month calendar of what your cards pay each day; overlaps flagged; best cards to add.', aka: ['calendar', 'otd calendar', 'overlap', 'claims'] },
  { id: 'edge', n: 9, route: '/edge', label: 'Edge / EV', summary: 'No-vig fair odds from Kalshi/Polymarket/DraftKings; type Real\'s % for EV, edge and Kelly stake.', aka: ['edge', 'ev', 'expected value', 'odds', 'kelly', 'predictions', 'betting', 'prediction market'] },
];

export const TAB_IDS = SITE_TABS.map((t) => t.id);

export const tabById = (id: string): SiteTab | undefined => SITE_TABS.find((t) => t.id === id || t.route === id || String(t.n) === id);

/** Resolve free text ("tab 7", "otd calendar", "/edge") to a tab. Longest alias wins. */
export function resolveTab(text: string): SiteTab | undefined {
  const q = text.toLowerCase().trim();
  if (!q) return undefined;
  const direct = tabById(q.replace(/^tab\s*/, ''));
  if (direct) return direct;
  let best: { tab: SiteTab; len: number } | undefined;
  for (const t of SITE_TABS) {
    for (const name of [t.label.toLowerCase(), t.id, ...t.aka]) {
      if (q.includes(name) && (!best || name.length > best.len)) best = { tab: t, len: name.length };
    }
  }
  return best?.tab;
}
