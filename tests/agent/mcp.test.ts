import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { onRequest } from '../../functions/mcp';

const PUB = path.resolve(__dirname, '../../public');
/** A Pages ASSETS binding backed by public/ — and, like the real SPA fallback, HTML for anything that doesn't exist. */
const ASSETS = {
  async fetch(req: Request | string) {
    const u = new URL(typeof req === 'string' ? req : req.url);
    const f = path.join(PUB, u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f), { headers: { 'Content-Type': u.pathname.endsWith('.json') ? 'application/json' : 'text/plain' } });
    return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  },
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  (onRequest as any)({
    request: new Request('https://rax.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    env: { ASSETS }, waitUntil() {},
  }) as Promise<Response>;
const rpc = async (method: string, params?: unknown, id: number | string = 1) => {
  const res = await post({ jsonrpc: '2.0', id, method, params });
  return { res, json: (await res.json()) as any };
};

describe('/mcp transport', () => {
  it('answers CORS preflight', async () => {
    const res: Response = await (onRequest as any)({ request: new Request('https://rax.test/mcp', { method: 'OPTIONS' }), env: { ASSETS }, waitUntil() {} });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Mcp-Protocol-Version/);
  });
  it('GET: 405 for the SSE stream, redirect for browsers, JSON card otherwise', async () => {
    const get = (accept: string) => (onRequest as any)({ request: new Request('https://rax.test/mcp', { headers: { Accept: accept } }), env: { ASSETS }, waitUntil() {} }) as Promise<Response>;
    expect((await get('text/event-stream')).status).toBe(405);
    const html = await get('text/html,application/xhtml+xml');
    expect(html.status).toBe(302);
    expect(html.headers.get('Location')).toBe('https://rax.test/?mcp=1');
    const card = await (await get('application/json')).json() as any;
    expect(card.endpoint).toBe('https://rax.test/mcp');
    expect(card.tools).toContain('search_docs');
  });
  it('rejects malformed JSON with a JSON-RPC parse error', async () => {
    const res = await post('{nope');
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });
  it('rejects non-JSON-RPC bodies and oversized bodies', async () => {
    expect(((await (await post({ hello: 1 })).json()) as any).error.code).toBe(-32600);
    expect((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } }))).status).toBe(413);
  });
  it('notifications get 202 with no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

describe('/mcp methods', () => {
  it('initialize negotiates the protocol version', async () => {
    const a = (await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json.result;
    expect(a.protocolVersion).toBe('2025-03-26');
    expect(a.capabilities.tools).toBeDefined();
    expect(a.serverInfo.name).toBe('rax-super-suite');
    expect(a.instructions).toMatch(/search_docs/);
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).json.result.protocolVersion).toBe('2025-06-18');
  });
  it('ping', async () => expect((await rpc('ping')).json.result).toEqual({}));
  it('tools/list is complete and read-only annotated', async () => {
    const { tools } = (await rpc('tools/list')).json.result;
    expect(tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['search_docs', 'otd_payout', 'ev_calc', 'live_odds', 'calculate']));
    expect(tools.map((t: any) => t.name)).not.toContain('request_feature');
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
  it('tools/call returns text + structuredContent', async () => {
    const r = (await rpc('tools/call', { name: 'calculate', arguments: { expression: '2*(3+4)' } })).json.result;
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content[0].text).result).toBe(14);
    expect(r.structuredContent.result).toBe(14);
  });
  it('tools/call: tool-level failure is isError, unknown tool is a protocol error', async () => {
    const bad = (await rpc('tools/call', { name: 'calculate', arguments: { expression: '1/0' } })).json.result;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/finite/);
    expect((await rpc('tools/call', { name: 'rm_rf' })).json.error.code).toBe(-32602);
  });
  it('search_docs works through the assets binding', async () => {
    const r = (await rpc('tools/call', { name: 'search_docs', arguments: { query: 'player card claim cost' } })).json.result;
    expect(r.structuredContent.results.length).toBeGreaterThan(0);
  });
  it('resources: list + read a doc + tabs, missing is an error', async () => {
    const list = (await rpc('resources/list')).json.result.resources;
    expect(list.length).toBeGreaterThan(20);
    const uri = list.find((x: any) => x.uri.includes('rax-site-guide')).uri;
    const read = (await rpc('resources/read', { uri })).json.result.contents[0];
    expect(read.mimeType).toBe('text/markdown');
    expect(read.text).toContain('Edge / EV');
    expect(JSON.parse((await rpc('resources/read', { uri: 'rax://site/tabs' })).json.result.contents[0].text)).toHaveLength(8);
    expect((await rpc('resources/read', { uri: 'rax://doc/nope' })).json.error.code).toBe(-32002);
  });
  it('prompts: list + get with required-arg validation', async () => {
    const { prompts } = (await rpc('prompts/list')).json.result;
    expect(prompts.map((p: any) => p.name)).toContain('plan_otd_budget');
    const got = (await rpc('prompts/get', { name: 'plan_otd_budget', arguments: { budget: '50000', sport: 'NFL' } })).json.result;
    expect(got.messages[0].content.text).toMatch(/50000/);
    expect((await rpc('prompts/get', { name: 'plan_otd_budget' })).json.error.message).toMatch(/budget/);
  });
  it('unknown method → -32601', async () => expect((await rpc('sampling/createMessage')).json.error.code).toBe(-32601));
  it('batches: mixed requests and notifications', async () => {
    const res = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const body = (await res.json()) as any[];
    expect(body.map((b) => b.id)).toEqual([1, 2]);
    expect((await post([])).status).toBe(400);
  });
  it('echoes string ids', async () => expect((await rpc('ping', undefined, 'abc')).json.id).toBe('abc'));
});
