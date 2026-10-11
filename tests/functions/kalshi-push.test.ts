import { describe, expect, it } from 'vitest';
import { onRequest } from '../../functions/api/odds/kalshi-push';

/** Minimal D1 stand-in: records prepared SQL + bound args. */
function fakeDb() {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  return { writes, db: { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ run: async () => void writes.push({ sql, args }) }) }) } };
}
const snap = (sport = 'NFL', generatedAt = '2026-10-11T18:00:00.000Z') => JSON.stringify({ generatedAt, sport, payloads: [] });
const call = (env: Record<string, unknown>, init: { method?: string; auth?: string; body?: string; sport?: string } = {}) =>
  (onRequest as any)({
    request: new Request(`https://rax.test/api/odds/kalshi-push?sport=${init.sport ?? 'NFL'}`, { method: init.method ?? 'POST', headers: init.auth ? { Authorization: init.auth } : {}, body: init.method === 'GET' ? undefined : init.body ?? snap() }),
    env,
  }) as Promise<Response>;

describe('POST /api/odds/kalshi-push', () => {
  it('stores a snapshot for the right sport when the secret matches', async () => {
    const { db, writes } = fakeDb();
    const r = await call({ ODDS_DB: db, KALSHI_PUSH_SECRET: 's3cret' }, { auth: 'Bearer s3cret' });
    expect(r.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].args.slice(0, 2)).toEqual(['NFL', '2026-10-11T18:00:00.000Z']);
    expect(writes[0].sql).toMatch(/excluded\.generated_at >= kalshi_snapshot\.generated_at/); // out-of-order pushes can't clobber newer data
  });
  it('rejects a missing/wrong secret, an unset server secret, and non-POST', async () => {
    const { db, writes } = fakeDb();
    expect((await call({ ODDS_DB: db, KALSHI_PUSH_SECRET: 's3cret' }, {})).status).toBe(401);
    expect((await call({ ODDS_DB: db, KALSHI_PUSH_SECRET: 's3cret' }, { auth: 'Bearer nope' })).status).toBe(401);
    expect((await call({ ODDS_DB: db }, { auth: 'Bearer x' })).status).toBe(503); // server secret not configured
    expect((await call({ ODDS_DB: db, KALSHI_PUSH_SECRET: 's3cret' }, { method: 'GET', auth: 'Bearer s3cret' })).status).toBe(405);
    expect(writes).toHaveLength(0);
  });
  it('validates sport and body shape', async () => {
    const { db, writes } = fakeDb();
    const env = { ODDS_DB: db, KALSHI_PUSH_SECRET: 's3cret' };
    expect((await call(env, { auth: 'Bearer s3cret', sport: 'CURLING' })).status).toBe(400);
    expect((await call(env, { auth: 'Bearer s3cret', body: 'not json' })).status).toBe(400);
    expect((await call(env, { auth: 'Bearer s3cret', body: snap('NHL') })).status).toBe(400); // body for another sport
    expect((await call(env, { auth: 'Bearer s3cret', body: JSON.stringify({ generatedAt: 'x', sport: 'NFL', payloads: [] }) })).status).toBe(400);
    expect((await call(env, { auth: 'Bearer s3cret', body: 'x'.repeat(1_600_000) })).status).toBe(413);
    expect(writes).toHaveLength(0);
  });
  it('503s when D1 is not bound', async () => {
    expect((await call({ KALSHI_PUSH_SECRET: 's3cret' }, { auth: 'Bearer s3cret' })).status).toBe(503);
  });
});
