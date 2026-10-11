/**
 * MCP endpoint  —  https://rax.vivaanshahani.com/mcp   (Streamable HTTP, public, read-only, no auth)
 *
 * Add it to any MCP client as a remote server (see docs/MCP.md or the MCP button at the top right of the site).
 * Browsers that open it get redirected to the site, where the MCP dialog explains how to connect.
 */
import { handleMcp, INSTRUCTIONS, MCP_VERSIONS, parseError, SERVER_INFO } from './_lib/mcp';
import { makeToolCtx, type AgentEnv } from './_lib/agentCtx';
import { rateLimit } from './_lib/ratelimit';
import { TOOLS } from '../shared/agent/tools';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
const MAX_BODY = 64 * 1024;

const jsonRes = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra } });

export const onRequest: PagesFunction<AgentEnv> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (request.method === 'GET') {
    const accept = request.headers.get('Accept') ?? '';
    if (accept.includes('text/event-stream')) return new Response('This server answers each POST directly; there is no server-initiated stream.', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } });
    if (accept.includes('text/html')) return Response.redirect(`${url.origin}/?mcp=1`, 302);
    return jsonRes({
      name: SERVER_INFO.name, title: SERVER_INFO.title, version: SERVER_INFO.version, transport: 'streamable-http', endpoint: `${url.origin}/mcp`,
      protocolVersions: MCP_VERSIONS, auth: 'none', readOnly: true, tools: TOOLS.map((t) => t.name), instructions: INSTRUCTIONS,
      docs: `${url.origin}/?mcp=1`,
    });
  }
  if (request.method === 'DELETE') return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } }); // no sessions to terminate
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, OPTIONS', ...CORS } });

  const rl = await rateLimit(request, 'mcp', 240, 600);
  if (!rl.allowed) return jsonRes({ jsonrpc: '2.0', id: null, error: { code: -32000, message: `Rate limit reached — retry in ${rl.retryAfter}s.` } }, 429, { 'Retry-After': String(rl.retryAfter) });

  const text = await request.text();
  if (text.length > MAX_BODY) return jsonRes({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large (max 64 KB).' } }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const e = parseError();
    return jsonRes(e.body, e.status);
  }
  const reply = await handleMcp(parsed, makeToolCtx(request, env, (p) => waitUntil(p)));
  if (reply.body === undefined) return new Response(null, { status: reply.status, headers: CORS });
  return jsonRes(reply.body, reply.status);
};
