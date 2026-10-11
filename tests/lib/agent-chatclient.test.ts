import { beforeEach, describe, expect, it, vi } from 'vitest';

const call = (name: string, args: unknown, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

let client: typeof import('../../src/agent/chatClient');
const st = { budget: 100000 };

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  // import the bridge AFTER the reset so the client under test and this setup share one instance
  const bridge = await import('../../src/agent/bridge');
  bridge.__reset();
  st.budget = 100000;
  bridge.noteRoute('/efficiency');
  bridge.registerSurface('efficiency', { current: { summary: () => st, params: { budget: { get: () => st.budget, set: (v) => void (st.budget = v as number) } } } });
  client = await import('../../src/agent/chatClient');
  client.clear();
});

describe('chat client', () => {
  it('finishes plain commands locally: one request, page changed, confirmation shown', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, type: 'tool_calls', messages: [{ role: 'assistant', content: '', tool_calls: [call('set_params', { tab: 'efficiency', values: { budget: '50k' } })] }], calls: [call('set_params', { tab: 'efficiency', values: { budget: '50k' } })], model: 'm', budgetLeft: 0.9 }));
    vi.stubGlobal('fetch', fetchMock);
    await client.send('set the budget to 50k');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(st.budget).toBe(50000);
    const last = client.getState().msgs.at(-1)!;
    expect(last.text).toMatch(/Set on \*\*OTD Efficiency\*\*: \*\*budget\*\* → 50000/);
    expect(last.steps?.[0].ok).toBe(true);
    expect(client.getState().busy).toBe(false);
  });

  it('sends tool results back for questions and shows the model\'s answer', async () => {
    const responses = [
      json({ ok: true, type: 'tool_calls', messages: [{ role: 'assistant', content: '', tool_calls: [call('get_page_state', { tab: 'efficiency' })] }], calls: [call('get_page_state', { tab: 'efficiency' })], model: 'm' }),
      json({ ok: true, type: 'message', messages: [{ role: 'assistant', content: 'Your budget is 100,000 Rax.' }], model: 'm', budgetLeft: 0.8 }),
    ];
    const fetchMock = vi.fn(async (_u: unknown, _i?: RequestInit) => responses.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    await client.send('what is my budget?');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', name: 'get_page_state' });
    expect(JSON.parse(second.messages.at(-1).content).summary.budget).toBe(100000);
    expect(second.context.tabs.find((t: any) => t.id === 'efficiency').params.find((p: any) => p.name === 'budget').value).toBe(100000);
    expect(client.getState().msgs.at(-1)!.text).toBe('Your budget is 100,000 Rax.');
    expect(client.getState().budgetLeft).toBe(0.8);
  });

  it('stops when the model keeps repeating the same page call', async () => {
    const c = call('get_page_state', { tab: 'scout' });
    const fetchMock = vi.fn(async () => json({ ok: true, type: 'tool_calls', messages: [{ role: 'assistant', content: '', tool_calls: [{ ...c, id: `c${Math.random()}` }] }], calls: [{ ...c, id: `c${Math.random()}` }], model: 'm' }));
    vi.stubGlobal('fetch', fetchMock);
    await client.send('what is going on?');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(client.getState().msgs.at(-1)!.text).toMatch(/repeating myself/);
  });

  it('falls back to the offline helper when the allowance is spent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, code: 'budget', message: 'used up' })));
    await client.send('hello?');
    const s = client.getState();
    expect(s.mode).toBe('offline');
    expect(s.offlineReason).toMatch(/allowance/);
    expect(s.msgs.at(-1)!.offline).toBe(true);
  });

  it('applies commands offline too', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u).endsWith('/api/chat') && !String(u).includes('docs') ? json({ ok: false, code: 'ai_unavailable', message: 'no ai' }) : json({ results: [] }))));
    await client.send('set budget to 25k');
    expect(st.budget).toBe(25000);
    expect(client.getState().msgs.at(-1)!.text).toMatch(/Done on/);
  });

  it('shows rate limiting as an error message, not an offline switch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, code: 'rate_limited', message: 'Slow down for 30s.' })));
    await client.send('hi');
    const s = client.getState();
    expect(s.mode).toBe('ai');
    expect(s.msgs.at(-1)).toMatchObject({ text: 'Slow down for 30s.', error: true });
  });

  it('survives a network failure by going offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await client.send('set budget to 1k');
    expect(client.getState().mode).toBe('offline');
    expect(st.budget).toBe(1000);
  });

  it('parses the streaming NDJSON transport', async () => {
    const lines = [{ t: 'status', text: 'Searching the docs…' }, { t: 'done', res: { ok: true, type: 'message', messages: [{ role: 'assistant', content: 'streamed answer' }], model: 'm' } }].map((l) => `${JSON.stringify(l)}\n`);
    const body = new ReadableStream({ start(c) { lines.forEach((l) => c.enqueue(new TextEncoder().encode(l))); c.close(); } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })));
    await client.send('explain karma');
    expect(client.getState().msgs.at(-1)!.text).toBe('streamed answer');
  });

  it('keeps history across clear/restore and limits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, type: 'message', messages: [{ role: 'assistant', content: 'a' }], model: 'm' })));
    await client.send('one');
    expect(client.getState().msgs).toHaveLength(2);
    client.clear();
    expect(client.getState().msgs).toHaveLength(0);
  });
});
