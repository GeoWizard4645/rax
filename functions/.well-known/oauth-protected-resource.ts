/**
 * The MCP server is public and needs no sign-in. MCP clients probe OAuth discovery first; without this, the SPA fallback
 * (`/* → index.html 200`) would answer with HTML and some clients treat that as a broken OAuth server instead of "no auth".
 */
export const onRequest: PagesFunction = () =>
  new Response(JSON.stringify({ error: 'not_found', message: 'This server uses no authentication.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  });
