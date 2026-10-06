import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest, validateWrite } from '../../functions/api/proxy/rateboard';
import { RB_BOARD_KEY, TARGET_POST_PREFIX } from '../../shared/rateboard';
const J = (r: Response): Promise<any> => r.json() as Promise<any>;

const call = (url: string, init?: RequestInit) =>
  (onRequest as any)({ request: new Request(`https://rax.test${url}`, init), env: {}, waitUntil: () => {} }) as Promise<Response>;

const RAW_BOARD = JSON.stringify({
  users: { ann: { name: 'Ann', hash: 's:' + 'a'.repeat(64) }, bob: { name: 'Bob', hash: 's:' + 'b'.repeat(64), banned: true }, reset: { name: 'Reset' } },
  offers: [{ id: 'o1', user: 'ann', sport: 'NFL', player: 'Josh Allen', rate: 30, link: `${TARGET_POST_PREFIX}1`, ts: 1 }],
  reports: [{ reason: 'TOP SECRET REPORT' }],
  gamedata: ['grantee'],
  minimums: [], keeplist: [], house: [],
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: any, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

const kvOk = () => new Response(JSON.stringify({ value: RAW_BOARD }), { headers: { 'content-type': 'application/json' } });

describe('GET /api/proxy/rateboard', () => {
  it('forwards the board read to Rateboard and strips hashes + reports', async () => {
    const spy = stubFetch(() => kvOk());
    const res = await call(`/api/proxy/rateboard?path=api/kv&key=${RB_BOARD_KEY}`);
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe(`https://rateboard-cgi.pages.dev/api/kv?key=${RB_BOARD_KEY}`);
    const text = await res.text();
    expect(text).not.toContain('aaaaaaaa');
    expect(text).not.toContain('TOP SECRET');
    expect(text).not.toContain('grantee');
    const body = JSON.parse(text);
    expect(body.board.users.ann).toMatchObject({ name: 'Ann', hasPassword: true });
    expect(body.board.users.reset.hasPassword).toBe(false);
    expect(body.board.offers).toHaveLength(1);
    expect(res.headers.get('x-data-source')).toBe('rateboard-cgi.pages.dev');
    expect(res.headers.get('x-credit')).toContain('Rateboard');
  });

  it('refuses to read any other KV key (snapshots, data reports…)', async () => {
    const spy = stubFetch(() => kvOk());
    for (const q of ['key=other', 'snap=list', 'datareports=1']) {
      const res = await call(`/api/proxy/rateboard?path=api/kv&${q}`);
      expect(res.status).toBe(403);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses gated / paid endpoints', async () => {
    const spy = stubFetch(() => kvOk());
    for (const p of ['api/rax', 'api/scan', 'api/admin', '../etc/passwd', 'api/kv/../scan']) {
      expect((await call(`/api/proxy/rateboard?path=${encodeURIComponent(p)}`)).status).toBe(403);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('proxies player search with validated params', async () => {
    const spy = stubFetch(() => new Response('{"players":[{"name":"Josh Allen","team":"BUF"}]}', { headers: { 'content-type': 'application/json' } }));
    const res = await call('/api/proxy/rateboard?path=api/players&sport=NFL&q=josh');
    expect((await J(res)).players[0].name).toBe('Josh Allen');
    expect(spy.mock.calls[0][0]).toBe('https://rateboard-cgi.pages.dev/api/players?sport=NFL&q=josh');
    expect((await call('/api/proxy/rateboard?path=api/players&sport=XXX&q=josh')).status).toBe(400);
    expect(await J(await call('/api/proxy/rateboard?path=api/players&sport=NFL&q=j'))).toEqual({ players: [] });
  });

  it('passes the collection pull through and preserves the upstream cache header', async () => {
    const spy = stubFetch(() => new Response('{"players":[{"name":"A","total":2,"totalValue":10}],"hasMore":false}', { headers: { 'content-type': 'application/json', 'x-cache': 'HIT' } }));
    const res = await call('/api/proxy/rateboard?path=api/collection&username=some_user&sport=FC&start=0&hashId=abc-123');
    expect(res.headers.get('x-upstream-cache')).toBe('HIT');
    expect(spy.mock.calls[0][0]).toBe('https://rateboard-cgi.pages.dev/api/collection?username=some_user&sport=FC&start=0&hashId=abc-123');
    expect((await J(res)).players[0].total).toBe(2);
  });

  it('relays upstream errors (e.g. unknown user) with their status', async () => {
    stubFetch(() => new Response('{"error":"RS user \\"x\\" not found"}', { status: 404, headers: { 'content-type': 'application/json' } }));
    const res = await call('/api/proxy/rateboard?path=api/collection&username=x&sport=NFL&start=0');
    expect(res.status).toBe(404);
    expect((await J(res)).error).toContain('not found');
  });

  it('validates collection params', async () => {
    stubFetch(() => kvOk());
    expect((await call('/api/proxy/rateboard?path=api/collection&username=a%2Fb&sport=NFL')).status).toBe(400);
    expect((await call('/api/proxy/rateboard?path=api/collection&username=ok&sport=NFL&start=-1')).status).toBe(400);
    expect((await call('/api/proxy/rateboard?path=api/collection&username=ok&sport=NFL&hashId=a%26b')).status).toBe(400);
  });

  it('reports an unreachable upstream as 502', async () => {
    stubFetch(() => { throw new Error('boom'); });
    const res = await call(`/api/proxy/rateboard?path=api/kv&key=${RB_BOARD_KEY}`);
    expect(res.status).toBe(502);
  });
});

const goodOffer = { id: 'abc123', user: 'ann', sport: 'NFL', player: 'Josh Allen', rate: 30, link: `${TARGET_POST_PREFIX}99` };

describe('POST /api/proxy/rateboard (writes)', () => {
  const post = (path: string, body: unknown) => call(`/api/proxy/rateboard?path=${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('forwards a valid addOffer to Rateboard exactly as its own client would', async () => {
    const spy = stubFetch(() => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const res = await post('api/kv', { op: 'addOffer', offer: goodOffer });
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://rateboard-cgi.pages.dev/api/kv');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ op: 'addOffer', offer: goodOffer });
  });

  it('NEVER relays whole-board overwrites', async () => {
    const spy = stubFetch(() => new Response('{}'));
    const res = await post('api/kv', { key: RB_BOARD_KEY, value: '{"users":{}}' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('NEVER relays admin operations', async () => {
    const spy = stubFetch(() => new Response('{}'));
    for (const body of [{ op: 'resetPass', key: 'ann' }, { op: 'resolveDataReport', id: 'x' }, { op: 'removeOffer', id: 'abc' }, { op: 'banUser', key: 'ann' }]) {
      expect((await post('api/kv', body)).status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not expose /api/scan or other POST paths', async () => {
    const spy = stubFetch(() => new Response('{}'));
    expect((await post('api/scan', { content: [] })).status).toBe(403);
    expect((await post('api/ufc', {})).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects malformed writes', () => {
    const bad = (b: unknown) => expect(validateWrite(b).ok).toBe(false);
    bad({ op: 'addOffer', offer: { ...goodOffer, rate: 0 } });
    bad({ op: 'addOffer', offer: { ...goodOffer, rate: 1.5 } });
    bad({ op: 'addOffer', offer: { ...goodOffer, rate: 10000 } });
    bad({ op: 'addOffer', offer: { ...goodOffer, sport: 'NBA' } });
    bad({ op: 'addOffer', offer: { ...goodOffer, link: 'https://evil.example/x' } });
    bad({ op: 'addOffer', offer: { ...goodOffer, id: 'a b' } });
    bad({ op: 'signup', key: 'Ann', name: 'Ann', hash: 's:' + 'a'.repeat(64) }); // key must be lowercase
    bad({ op: 'signup', key: 'ann', name: 'Ann', hash: 'plaintext' });
    bad({ op: 'updateOffer', id: 'abc', user: 'ann', rate: 20, link: 'nope' });
    bad(null);
  });

  it('accepts the other legitimate ops', () => {
    expect(validateWrite({ op: 'signup', key: 'ann', name: 'Ann', hash: 's:' + 'a'.repeat(64) }).ok).toBe(true);
    expect(validateWrite({ op: 'setPass', key: 'ann', hash: 'f:' + 'a'.repeat(16) }).ok).toBe(true);
    expect(validateWrite({ op: 'updateOffer', id: 'abc', user: 'ann', rate: 20, link: `${TARGET_POST_PREFIX}1` }).ok).toBe(true);
    expect(validateWrite({ op: 'removeOffer', id: 'abc', user: 'ann' }).ok).toBe(true);
  });

  it('drops unknown fields before forwarding', () => {
    const v = validateWrite({ op: 'removeOffer', id: 'abc', user: 'ann', admin: true, extra: 1 });
    expect(v.ok && v.body).toEqual({ op: 'removeOffer', id: 'abc', user: 'ann' });
  });
});

describe('POST _login (server-side password check)', () => {
  const login = (username: string, hash: string) =>
    call('/api/proxy/rateboard?path=_login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, hash }) });
  const A = 's:' + 'a'.repeat(64);

  it('answers ok / wrong / banned / reset / new', async () => {
    stubFetch(() => kvOk());
    expect(await J(await login('Ann', A))).toMatchObject({ status: 'ok', key: 'ann', name: 'Ann' });
    expect((await J(await login('ann', 's:' + 'c'.repeat(64)))).status).toBe('wrong');
    expect((await J(await login('bob', 's:' + 'b'.repeat(64)))).status).toBe('banned');
    expect((await J(await login('reset', A))).status).toBe('reset');
    expect((await J(await login('brand-new', A))).status).toBe('new');
  });

  it('never echoes hashes and is not cacheable', async () => {
    stubFetch(() => kvOk());
    const res = await login('ann', A);
    expect(await res.text()).not.toContain('aaaaaaaa');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('validates input', async () => {
    stubFetch(() => kvOk());
    expect((await login('a', A)).status).toBe(400);
    expect((await login('ann', 'plain')).status).toBe(400);
  });
});
