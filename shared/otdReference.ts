/**
 * Hard-coded reference numbers from Real community guides ("Rax Academy" albums by Dennis, 2026) — used as GROUND TRUTH
 * to validate the observed dataset and the rating model, and shown in the UI as the "community leaderboard".
 *
 * `general` = a card's total OTD earnings at General level for one season ("Earnings at General" in the guides).
 * Iconic payout = general × 150 (e.g. Edey 708 → 106,200). These are facts transcribed from public posts; they were
 * current as of mid-2026 and the rules (buffs, caps) change — treat as a snapshot.
 *
 * `rawLabel` is the season as the guide writes it; use `seasonLabelFor` in otdSnapshot.ts to map to Rax's label
 * (NBA/CBB "23-24" → Rax season 2024; NFL/NHL/CFB "23-24" → 2023; MLB/golf "2025" → 2025).
 */
import type { OtdSport } from './otdSnapshot';

export interface RefCard {
  sport: OtdSport;
  rawLabel: string;
  name: string;
  general: number;
  /** Set when the guide notes the figure predates a rule change (CBB ×2.5 / CFB ×5 buff of July 2026). */
  note?: string;
}

export const ICONIC_MULT = 150;

export const REFERENCE_CARDS: RefCard[] = [
  // NBA
  { sport: 'NBA', rawLabel: '23-24', name: 'Luka Dončić', general: 627 },
  { sport: 'NBA', rawLabel: '24-25', name: 'Shai Gilgeous-Alexander', general: 617 },
  { sport: 'NBA', rawLabel: '22-23', name: 'Nikola Jokić', general: 591 },
  { sport: 'NBA', rawLabel: '24-25', name: 'Nikola Jokić', general: 560 },
  { sport: 'NBA', rawLabel: '23-24', name: 'Nikola Jokić', general: 559 },
  { sport: 'NBA', rawLabel: '22-23', name: 'Jayson Tatum', general: 550 },
  { sport: 'NBA', rawLabel: '23-24', name: 'Jayson Tatum', general: 496 },
  { sport: 'NBA', rawLabel: '25-26', name: 'Victor Wembanyama', general: 488 },
  { sport: 'NBA', rawLabel: '23-24', name: 'Shai Gilgeous-Alexander', general: 480 },
  { sport: 'NBA', rawLabel: '22-23', name: 'Jimmy Butler III', general: 476 },
  // NHL
  { sport: 'NHL', rawLabel: '23-24', name: 'Connor McDavid', general: 626 },
  { sport: 'NHL', rawLabel: '23-24', name: 'Leon Draisaitl', general: 590 },
  { sport: 'NHL', rawLabel: '24-25', name: 'Leon Draisaitl', general: 563 },
  { sport: 'NHL', rawLabel: '23-24', name: 'Nathan MacKinnon', general: 560 },
  { sport: 'NHL', rawLabel: '22-23', name: 'Connor McDavid', general: 555 },
  { sport: 'NHL', rawLabel: '23-24', name: 'Vincent Trocheck', general: 529 },
  { sport: 'NHL', rawLabel: '22-23', name: 'Leon Draisaitl', general: 516 },
  { sport: 'NHL', rawLabel: '25-26', name: 'Nathan MacKinnon', general: 515 },
  { sport: 'NHL', rawLabel: '23-24', name: 'Auston Matthews', general: 511 },
  { sport: 'NHL', rawLabel: '24-25', name: 'Connor McDavid', general: 508 },
  // MLB
  { sport: 'MLB', rawLabel: '2025', name: 'Shohei Ohtani', general: 715 },
  { sport: 'MLB', rawLabel: '2023', name: 'Shohei Ohtani', general: 673 },
  { sport: 'MLB', rawLabel: '2024', name: 'Shohei Ohtani', general: 665 },
  { sport: 'MLB', rawLabel: '2022', name: 'Shohei Ohtani', general: 656 },
  { sport: 'MLB', rawLabel: '2024', name: 'Aaron Judge', general: 606 },
  { sport: 'MLB', rawLabel: '2025', name: 'Yoshinobu Yamamoto', general: 556 },
  { sport: 'MLB', rawLabel: '2023', name: 'Ronald Acuña Jr.', general: 555 },
  { sport: 'MLB', rawLabel: '2024', name: 'Juan Soto', general: 546 },
  { sport: 'MLB', rawLabel: '2024', name: 'Tarik Skubal', general: 528 },
  { sport: 'MLB', rawLabel: '2022', name: 'Aaron Judge', general: 518 },
  // NFL
  { sport: 'NFL', rawLabel: '24-25', name: 'Saquon Barkley', general: 707 },
  { sport: 'NFL', rawLabel: '23-24', name: 'Christian McCaffrey', general: 624 },
  { sport: 'NFL', rawLabel: '24-25', name: 'Derrick Henry', general: 561 },
  { sport: 'NFL', rawLabel: '25-26', name: 'Christian McCaffrey', general: 526 },
  { sport: 'NFL', rawLabel: '25-26', name: 'Puka Nacua', general: 512 },
  { sport: 'NFL', rawLabel: '25-26', name: 'Matthew Stafford', general: 493 },
  { sport: 'NFL', rawLabel: '23-24', name: 'Patrick Mahomes', general: 440 },
  // College basketball — AFTER the July-2026 buff (reg-season ×2.5, playoffs ×5; was ×2 / ×4)
  { sport: 'CBB', rawLabel: '23-24', name: 'Zach Edey', general: 708, note: 'post-buff (was 565)' },
  { sport: 'CBB', rawLabel: '25-26', name: 'Cameron Boozer', general: 568 },
  { sport: 'CBB', rawLabel: '24-25', name: 'Yaxel Lendeborg', general: 536 },
  { sport: 'CBB', rawLabel: '24-25', name: 'Cooper Flagg', general: 529 },
  { sport: 'CBB', rawLabel: '24-25', name: 'Johni Broome', general: 513 },
  { sport: 'CBB', rawLabel: '23-24', name: 'Mark Sears', general: 497 },
  { sport: 'CBB', rawLabel: '25-26', name: 'Yaxel Lendeborg', general: 493 },
  { sport: 'CBB', rawLabel: '25-26', name: 'Darius Acuff Jr.', general: 474 },
  { sport: 'CBB', rawLabel: '25-26', name: 'Zuby Ejiofor', general: 467 },
  { sport: 'CBB', rawLabel: '24-25', name: 'Ryan Kalkbrenner', general: 466 },
  // College football — AFTER the July-2026 buff (reg ×5 / ×8, playoffs ×10 / ×16; was ×4 / ×7, ×8 / ×14)
  { sport: 'CFB', rawLabel: '24-25', name: 'Ashton Jeanty', general: 669, note: 'post-buff (was 537)' },
  { sport: 'CFB', rawLabel: '24-25', name: 'Travis Hunter', general: 647 },
  { sport: 'CFB', rawLabel: '24-25', name: 'Cam Skattebo', general: 616, note: 'post-buff (was 491)' },
  { sport: 'CFB', rawLabel: '24-25', name: 'Tre Stewart', general: 524 },
  { sport: 'CFB', rawLabel: '25-26', name: 'Caleb Hawkins', general: 487 },
  { sport: 'CFB', rawLabel: '25-26', name: 'Kewan Lacy', general: 486 },
  { sport: 'CFB', rawLabel: '23-24', name: 'Ollie Gordon II', general: 484 },
  { sport: 'CFB', rawLabel: '24-25', name: 'Xavier Watts', general: 482 },
  { sport: 'CFB', rawLabel: '25-26', name: 'Suntarine Perkins', general: 456 },
  { sport: 'CFB', rawLabel: '23-24', name: 'Bo Nix', general: 452 },
  // WNBA (from the overall top-16 list, Iconic ÷ 150)
  { sport: 'WNBA', rawLabel: '2025', name: "A'ja Wilson", general: 671 },
  { sport: 'WNBA', rawLabel: '2024', name: 'Napheesa Collier', general: 570 },
  // Golf — numbers are AFTER "triple overlaps" in the guide's own grind plan, so treat as a floor for the raw season total
  { sport: 'PGA', rawLabel: '2025', name: 'Scottie Scheffler', general: 609 },
  { sport: 'PGA', rawLabel: '2023', name: 'Scottie Scheffler', general: 601 },
  { sport: 'PGA', rawLabel: '2015', name: 'Jordan Spieth', general: 551 },
  { sport: 'PGA', rawLabel: '2024', name: 'Xander Schauffele', general: 535 },
  { sport: 'PGA', rawLabel: '2024', name: 'Scottie Scheffler', general: 531 },
  { sport: 'PGA', rawLabel: '2021', name: 'Sungjae Im', general: 504 },
];

/**
 * "actual OTD caps" post (Rax Academy): the maximum a single card can earn from OTD per year, by rarity level.
 * Iconic is uncapped. General cards do not earn. UFC has its own (higher-per-tier, fewer-tier) table.
 * Whether the cap is per calendar year or per season-card is stated by the guide's title only; the rules agent verifies.
 */
export const OTD_CAPS_NON_UFC: Record<string, number | null> = {
  General: 0,
  Common: 1_000,
  Uncommon: 1_500,
  Rare: 2_000,
  Epic: 5_000,
  'Legendary 1': 12_500,
  'Legendary 2': 14_000,
  'Legendary 3': 16_000,
  'Legendary 4': 17_500,
  'Legendary 5': 20_000,
  'Mystic 1': 37_500,
  'Mystic 2': 39_500,
  'Mystic 3': 41_500,
  'Mystic 4': 43_500,
  'Mystic 5': 45_500,
  'Mystic 6': 47_500,
  'Mystic 7': 49_000,
  'Mystic 8': 50_500,
  'Mystic 9': 51_500,
  'Mystic 10': 52_500,
  Iconic: null,
};

export const OTD_CAPS_UFC: Record<string, number | null> = {
  Common: 1_500, Uncommon: 3_000, Rare: 6_000, Epic: 12_000, Legendary: 24_000, Mystic: 48_000, Iconic: null,
};
