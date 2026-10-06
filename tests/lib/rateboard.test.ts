import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asciiName, bigOrderMessage, bigOrders, bigOrdersHaul, blankBoard, buildMatches, checkNewOffer, copyMessage,
  hashPassword, houseFor, houseMessage, liveOffers, minimumFor, norm, owedFor, rateboardTradeUrl, readRate, samePlayer,
  sanitizeBoard, TARGET_POST_PREFIX, validCommentLink, type RbBoard,
} from '../../shared/rateboard';

const link = (n: number) => `${TARGET_POST_PREFIX}${n}`;

function board(): RbBoard {
  return {
    users: {
      ann: { name: 'Ann', hasPassword: true },
      bo: { name: 'Bo', hasPassword: true },
      cy: { name: 'Cy', hasPassword: true, banned: true },
    },
    offers: [
      { id: 'o1', user: 'ann', sport: 'NFL', player: 'Josh Allen', rate: 30, link: link(1), ts: 1 },
      { id: 'o2', user: 'bo', sport: 'NFL', player: 'Josh Allen', rate: 45, link: link(2), ts: 2 },
      { id: 'o3', user: 'bo', sport: 'NFL', player: 'Puka Nacua', rate: 25, link: link(3), ts: 3 },
      { id: 'o4', user: 'ann', sport: 'NFL', player: 'Puka Nacua', rate: 20, link: link(4), ts: 4 },
      { id: 'o5', user: 'cy', sport: 'NFL', player: 'Josh Allen', rate: 99, link: link(5), ts: 5 }, // banned
      { id: 'o6', user: 'ann', sport: 'FC', player: 'Erling Haaland', rate: 50, link: link(6), ts: 6 },
    ],
    minimums: [{ sport: 'NFL', player: 'Josh Allen', rate: 35 }, { sport: 'NFL', player: 'Josh Allen', rate: 40 }],
    keeplist: [{ sport: 'NFL', player: 'Puka Nacua' }],
    house: [{ sport: 'NFL', player: 'Julian Love', rate: 8 }, { sport: 'NFL', player: 'Byron Murphy II', rate: 8 }],
  };
}

describe('name matching (ported from Rateboard)', () => {
  it('normalises accents and suffixes', () => {
    expect(asciiName('Kylian Mbappé')).toBe('Kylian Mbappe');
    expect(asciiName('Martin Ødegaard')).toBe('Martin Odegaard');
    expect(norm('Luis Garcia Jr.')).toBe('luis garcia');
  });
  it('is strict on full names but lets a bare surname match', () => {
    expect(samePlayer('Matthew Coleman', 'Malachi Coleman')).toBe(false);
    expect(samePlayer('Haaland', 'Erling Haaland')).toBe(true);
    expect(samePlayer('Erling Haaland', 'erling haaland')).toBe(true);
    expect(samePlayer('', 'x')).toBe(false);
  });
  it('house list is suffix-sensitive', () => {
    const b = board();
    expect(houseFor(b, 'NFL', 'Byron Murphy II')?.exact).toBe(true);
    expect(houseFor(b, 'NFL', 'Byron Murphy Jr.')?.exact).toBe(false);
    expect(houseFor(b, 'NFL', 'Nobody')).toBeNull();
    expect(houseFor(b, 'FC', 'Julian Love')).toBeNull();
  });
  it('highest minimum wins', () => {
    expect(minimumFor(board(), 'NFL', 'Josh Allen')?.rate).toBe(40);
  });
});

describe('offers', () => {
  it('lists live offers best-rate first and hides banned users', () => {
    const l = liveOffers(board(), 'NFL');
    expect(l.map((o) => o.id)).toEqual(['o2', 'o1', 'o3', 'o4']);
  });
  it('validates comment links against the pinned post', () => {
    expect(validCommentLink(link(9))).toBe(true);
    expect(validCommentLink(TARGET_POST_PREFIX)).toBe(false);
    expect(validCommentLink('https://www.realapp.com/other/1')).toBe(false);
  });
  it('checkNewOffer reproduces Rateboard messages', () => {
    const b = board();
    expect(checkNewOffer(b, 'NFL', 'J', link(1), 20)).toEqual({ ok: false, error: 'Enter a player name.' });
    expect(checkNewOffer(b, 'NFL', 'Josh Allen', 'nope', 20)).toEqual({ ok: false, error: 'Paste the link to your comment under the pinned post first.' });
    expect(checkNewOffer(b, 'NFL', 'Julian Love', link(1), 20)).toMatchObject({ ok: false, error: expect.stringContaining("dennis's list at 8/1") });
    expect(checkNewOffer(b, 'NFL', 'Josh Allen', link(1), 30)).toEqual({ ok: false, error: "Josh Allen has a 40/1 minimum — you can't offer less." });
    expect(checkNewOffer(b, 'NFL', 'Josh Allen', link(1), NaN, 12)).toMatchObject({ ok: false, error: expect.stringContaining('40/1 minimum') });
    expect(checkNewOffer(b, 'NFL', 'Puka Nacua', link(1), null)).toEqual({ ok: false, error: "Pick the rate you'll pay." });
    expect(checkNewOffer(b, 'NFL', 'Puka Nacua', link(1), NaN, 0.2)).toMatchObject({ ok: false, error: expect.stringContaining('whole number from 1 to 9999') });
    expect(checkNewOffer(b, 'NFL', 'Josh Allen', link(1), 40)).toEqual({ ok: true, player: 'Josh Allen', rate: 40 });
  });
  it('readRate handles presets and custom', () => {
    expect(readRate('25', '')).toBe(25);
    expect(readRate('custom', '31')).toBe(31);
    expect(readRate('custom', '0')).toBeNaN();
    expect(readRate('custom', '10000')).toBeNaN();
    expect(readRate('custom', '20', 25)).toBeNaN();
  });
});

describe('seller matching + copy messages', () => {
  it('rounds owed to the nearest 10 and formats the message', () => {
    expect(owedFor(100.8, 45)).toBe(4540);
    expect(owedFor(87, 25)).toBe(2180);
    expect(copyMessage(100.8, 'Josh Allen', 45)).toBe('i have 100.8 Josh Allen 4540');
  });

  const cards = [
    { name: 'Josh Allen', totalValue: 100 },
    { name: 'Puka Nacua', totalValue: 80 },
    { name: 'Julian Love', totalValue: 50 },
    { name: 'Byron Murphy Jr.', totalValue: 40 },
    { name: 'Unwanted Guy', totalValue: 30 },
    { name: 'Keeper Kid', totalValue: 20 },
  ];

  it('matches buyers, blocks house players, suggests quicksells, excludes', () => {
    const b = board();
    b.keeplist.push({ sport: 'NFL', player: 'Keeper Kid' });
    const m = buildMatches(b, 'NFL', cards, ['Keeper Kid']);
    expect(m.rows.map((r) => r.player)).toEqual(['Josh Allen', 'Puka Nacua']);
    expect(m.rows[0].buyers.map((x) => x.buyer)).toEqual(['Bo', 'Ann']); // banned Cy excluded
    expect(m.totalBuyers).toBe(4);
    expect(m.haul).toBe(owedFor(100, 45) + owedFor(80, 25)); // best buyer for each
    expect(m.blocked.map((x) => [x.name, x.cfg.exact])).toEqual([['Julian Love', true], ['Byron Murphy Jr.', false]]);
    expect(m.quicksells.map((x) => x.name)).toEqual(['Byron Murphy Jr.'].filter(() => false).concat(['Unwanted Guy']));
    expect(m.noBuyer.map((x) => x.name)).toEqual(['Unwanted Guy']);
  });

  it('suggests no quicksells without a keep list for that sport', () => {
    const b = board();
    b.keeplist = [];
    expect(buildMatches(b, 'NFL', cards, []).quicksells).toEqual([]);
  });

  it('counts a hit with no rating as unpriced', () => {
    const m = buildMatches(board(), 'NFL', [{ name: 'Josh Allen' }, 'Puka Nacua'], []);
    expect(m.unpriced).toBe(2);
    expect(m.haul).toBe(0);
  });

  it('big orders: buyers wanting >1 card, best total first', () => {
    const m = buildMatches(board(), 'NFL', cards, []);
    const orders = bigOrders(m.rows);
    expect(orders.map((o) => o.who)).toEqual(['Bo', 'Ann']);
    const bo = orders[0];
    expect(bo.cards.map((c) => [c.player, c.owed])).toEqual([['Josh Allen', 4500], ['Puka Nacua', 2000]]);
    expect(bo.total).toBe(6500);
    expect(bigOrderMessage(bo)).toBe('i have 100 Josh Allen 4500\ni have 80 Puka Nacua 2000\ntotal 6,500');
    // each card counted once at its best owed
    expect(bigOrdersHaul(orders)).toEqual({ amount: 4500 + 2000, cards: 2 });
  });

  it('house message covers only exact matches', () => {
    const m = buildMatches(board(), 'NFL', cards, []);
    const h = houseMessage(m.blocked);
    expect(h.sure.map((x) => x.name)).toEqual(['Julian Love']);
    expect(h.check.map((x) => x.name)).toEqual(['Byron Murphy Jr.']);
    expect(h.msg).toBe(`i have 50 Julian Love ${owedFor(50, 8)}`);
  });
});

describe('sanitizeBoard', () => {
  it('never lets password hashes, reports or grants through', () => {
    const raw = {
      value: JSON.stringify({
        users: { ann: { name: 'Ann', hash: 's:deadbeef', created: 5 }, reset: { name: 'Reset' } },
        offers: [{ id: 'a' }],
        reports: [{ by: 'x', target: 'y', reason: 'secret' }],
        gamedata: ['someone'],
        minimums: [],
        keeplist: [],
        house: [],
      }),
    };
    const b = sanitizeBoard(raw);
    expect(JSON.stringify(b)).not.toContain('deadbeef');
    expect(JSON.stringify(b)).not.toContain('secret');
    expect(b.users.ann).toEqual({ name: 'Ann', created: 5, banned: false, hasPassword: true });
    expect(b.users.reset.hasPassword).toBe(false);
    expect((b as any).reports).toBeUndefined();
    expect((b as any).gamedata).toBeUndefined();
  });
  it('tolerates junk', () => {
    expect(sanitizeBoard(null)).toEqual(blankBoard());
    expect(sanitizeBoard({ value: '{"users":{"a":null}}' }).users).toEqual({});
  });
});

describe('hashPassword', () => {
  it('matches Rateboard: "s:" + sha256("rb1:" + password)', async () => {
    const expected = 's:' + createHash('sha256').update('rb1:hunter22').digest('hex');
    expect(await hashPassword('hunter22')).toBe(expected);
  });
});

describe('outbound link', () => {
  it('builds the spec deep link', () => {
    expect(rateboardTradeUrl('abc 1', 'NFL')).toBe('https://rateboard-cgi.pages.dev/?card=abc+1&action=trade&sport=NFL');
  });
});
