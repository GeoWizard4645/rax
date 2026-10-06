/**
 * CDN image proxy  —  /api/proxy/cdn?url=https://<cdn-host>/path.png[&download=1&filename=name.png]
 *
 * Lets the browser preview and download CDN images without cross-origin blocks. It is NOT an open
 * proxy: the host must be listed in CDN_ALLOWED_HOSTS, only https is allowed, redirects are
 * re-validated hop by hop, the response must be an image, and size is capped.
 */
import { CORS, err, preflight, type Env } from '../../_lib/http';

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export function hostAllowed(host: string, allowCsv: string | undefined): boolean {
  if (!allowCsv) return false;
  const h = host.toLowerCase();
  return allowCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => (rule.startsWith('*.') ? h.endsWith(rule.slice(1)) && h.length > rule.length - 1 : h === rule));
}

export function safeFilename(raw: string | null, fallback: string): string {
  let base = (raw || '').split(/[\\/]/).pop() || '';
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep as-is */
  }
  const name = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80);
  return name || fallback;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');

  const params = new URL(request.url).searchParams;
  if (!env.CDN_ALLOWED_HOSTS) {
    return err(503, 'cdn_not_configured', 'Set CDN_ALLOWED_HOSTS (comma-separated CDN hostnames) in the Pages environment to enable the asset downloader.');
  }

  let target: URL;
  try {
    target = new URL(params.get('url') || '');
  } catch {
    return err(400, 'bad_url', 'Pass a full https URL in ?url=.');
  }

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (target.protocol !== 'https:') return err(400, 'https_only', 'Only https URLs are allowed.');
      if (target.username || target.password) return err(400, 'bad_url', 'Credentials in URLs are not allowed.');
      if (!hostAllowed(target.hostname, env.CDN_ALLOWED_HOSTS)) return err(403, 'host_not_allowed', `${target.hostname} is not on the CDN allowlist.`);
      res = await fetch(target.toString(), { redirect: 'manual', headers: { Accept: 'image/*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        target = new URL(res.headers.get('location')!, target);
        res = null;
        continue;
      }
      break;
    }
    if (!res) return err(502, 'too_many_redirects', 'Too many redirects.');
    if (!res.ok) return err(res.status === 404 ? 404 : 502, 'upstream_error', `CDN answered ${res.status}.`);

    const type = res.headers.get('content-type') || '';
    if (!type.toLowerCase().startsWith('image/')) return err(415, 'not_an_image', 'The URL did not return an image.');
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return err(413, 'too_large', 'Image exceeds 15 MB.');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return err(413, 'too_large', 'Image exceeds 15 MB.');

    const headers = new Headers(CORS);
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (params.get('download') === '1') {
      const last = target.pathname.split('/').filter(Boolean).pop() || 'asset';
      headers.set('Content-Disposition', `attachment; filename="${safeFilename(params.get('filename'), safeFilename(last, 'asset'))}"`);
    }
    return new Response(buf, { status: 200, headers });
  } catch (e) {
    return err(502, 'upstream_unreachable', `Could not reach the CDN: ${(e as Error).message}`);
  }
};
