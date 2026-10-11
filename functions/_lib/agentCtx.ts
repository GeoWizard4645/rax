/** Builds the ToolCtx for the edge: knowledge base from static assets, live data by calling this site's own handlers in-process. */
import type { ToolCtx } from '../../shared/agent/tools';
import { onRequest as oddsEvents } from '../api/odds/events';
import { onRequest as schedule } from '../api/intel/schedule';
import { makeKb, type AssetsEnv } from './kb';
import type { Env } from './http';

export type AgentEnv = Env & AssetsEnv;

const ROUTES: Record<string, PagesFunction<Env>> = {
  '/api/odds/events': oddsEvents,
  '/api/intel/schedule': schedule,
};

export function makeToolCtx(request: Request, env: AgentEnv, waitUntil: (p: Promise<unknown>) => void): ToolCtx {
  const origin = new URL(request.url).origin;
  return {
    kb: makeKb(env, origin),
    async getJson(pathAndQuery) {
      const url = new URL(pathAndQuery, origin);
      const handler = ROUTES[url.pathname];
      if (!handler) throw new Error(`No such internal route: ${url.pathname}`);
      const res = await (handler as unknown as (c: unknown) => Promise<Response>)({ request: new Request(url.toString()), env, waitUntil, params: {}, data: {}, next: () => Promise.reject(new Error('n/a')), functionPath: url.pathname });
      if (!res.ok) throw new Error(`${url.pathname} answered HTTP ${res.status}`);
      return res.json();
    },
  };
}
