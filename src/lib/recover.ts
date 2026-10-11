/**
 * Self-healing for stale or poisoned JS chunks.
 *
 * Every deploy renames /assets/*.js. A tab opened before a deploy (or a request that raced one) can ask for a file that no longer
 * exists; the SPA fallback answers with index.html, and /assets/* is `immutable`, so the browser may keep that HTML under the JS URL.
 * Result: a blank page that a normal reload doesn't fix. `refreshAndReload` re-downloads the file bypassing the HTTP cache (which
 * replaces the bad entry) and reloads — at most once per minute so a genuinely broken deploy can't loop.
 */
const KEY = 'rax_recover_at';

export const isChunkError = (e: unknown): boolean => {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk .* failed|MIME type/i.test(m);
};

export async function refreshAndReload(urls: string[] = []): Promise<boolean> {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked: still try once */
  }
  const own = Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href]')).map((el) => ('src' in el && el.src) || (el as HTMLLinkElement).href);
  await Promise.all([...new Set([...own, ...urls, location.href])].map((u) => fetch(u, { cache: 'reload' }).catch(() => undefined)));
  location.reload();
  return true;
}
