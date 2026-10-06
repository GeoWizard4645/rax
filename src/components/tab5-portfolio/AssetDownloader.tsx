import { useEffect, useState } from 'react';
import { Download, Link2 } from 'lucide-react';
import { load, save } from '../../lib/storage';
import { slug } from '../../lib/format';
import { Segmented } from '../ui/Segmented';

type Cat = 'cutouts' | 'frames' | 'badges' | 'avatars';
const CATS: Array<{ value: Cat; label: string; hint: string; example: string }> = [
  { value: 'cutouts', label: 'Player cutouts', hint: 'Raw transparent .png cutouts', example: 'https://media.realapp.com/<path-to-cutout>/{id}.png' },
  { value: 'frames', label: 'Backgrounds & frames', hint: 'Card backgrounds and frame borders', example: 'https://media.realapp.com/<path-to-frame>/{id}.png' },
  { value: 'badges', label: 'League & team badges', hint: 'League and team logos', example: 'https://media.realapp.com/<path-to-badge>/{id}.png' },
  { value: 'avatars', label: 'Avatars & icons', hint: 'Profile avatars and custom icons', example: 'https://media.realapp.com/<path-to-avatar>/{id}.png' },
];
const KEY = 'rax_cdn_templates_v1';

/** Resolve CDN image links, preview them and download through the edge proxy (no cross-origin blocks). */
export default function AssetDownloader() {
  const [cat, setCat] = useState<Cat>('cutouts');
  const [templates, setTemplates] = useState<Record<string, string>>(() => load(KEY, {}));
  const [id, setId] = useState('');
  const [direct, setDirect] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [broken, setBroken] = useState(false);

  // A request to a host that can't be allowlisted tells us whether CDN_ALLOWED_HOSTS is set (503 = not configured).
  useEffect(() => {
    fetch('/api/proxy/cdn?url=' + encodeURIComponent('https://probe.invalid/x.png'))
      .then((r) => setConfigured(r.status !== 503))
      .catch(() => setConfigured(null));
  }, []);

  const meta = CATS.find((c) => c.value === cat)!;
  const template = templates[cat] ?? '';
  const resolved = direct.trim() || (template && id.trim() ? template.replace(/\{id\}/g, encodeURIComponent(id.trim())) : '');
  const valid = /^https:\/\//.test(resolved);
  const proxied = valid ? `/api/proxy/cdn?url=${encodeURIComponent(resolved)}` : '';
  const filename = `${slug(id.trim() || resolved.split('/').pop() || 'asset')}.png`;

  return (
    <div className="space-y-4">
      {configured === false && (
        <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90">
          <b>CDN proxy not configured.</b> Set <span className="num">CDN_ALLOWED_HOSTS</span> (comma-separated CDN hostnames) in the Cloudflare Pages environment. The proxy refuses every other host — it is deliberately not an open proxy.
        </div>
      )}
      <div className="panel">
        <div className="panel-hd flex-wrap">
          <h2>CDN asset downloader</h2>
          <Segmented value={cat} onChange={(c) => (setCat(c), setBroken(false))} label="Asset type" options={CATS.map((c) => ({ value: c.value, label: c.label }))} />
        </div>
        <div className="panel-bd grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <p className="hint">{meta.hint}</p>
            <div>
              <label className="label" htmlFor="direct"><Link2 size={11} className="mr-1 inline" />Paste a direct image URL</label>
              <input id="direct" className="field num" value={direct} onChange={(e) => { setDirect(e.target.value); setBroken(false); }} placeholder="https://media.realapp.com/…" autoComplete="off" />
              <p className="hint mt-1">
                In the Real web app, right-click a card or avatar → <i>Copy image address</i>, then paste it here. Images come from <span className="num">media.realapp.com</span>, a public CDN.{' '}
                <button type="button" className="underline" onClick={() => { setDirect('https://media.realapp.com/assets/favicons/favicon-192.png'); setBroken(false); }}>Try a known public asset</button>
              </p>
            </div>
            <details className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted">Or build URLs from a template + id</summary>
              <div className="mt-3 space-y-3">
            <div>
              <label className="label" htmlFor="tpl">URL template for this type</label>
              <input id="tpl" className="field num" value={template} placeholder={meta.example} onChange={(e) => { const t = { ...templates, [cat]: e.target.value }; setTemplates(t); save(KEY, t); }} />
              <p className="hint mt-1">Use <span className="num">{'{id}'}</span> where the asset id goes. The CDN's real paths aren't known to this tool, so paste the pattern once — it's remembered in this browser.</p>
            </div>
            <div>
              <label className="label" htmlFor="aid">Asset id</label>
              <input id="aid" className="field num" value={id} onChange={(e) => { setId(e.target.value); setBroken(false); }} placeholder="e.g. 12345" autoComplete="off" />
            </div>
              </div>
            </details>
            <div className="num break-all rounded-md border border-line bg-base px-2.5 py-1.5 text-xs text-muted">{resolved || 'Resolved URL appears here'}</div>
            <a className={`btn-primary w-full !no-underline ${proxied ? '' : 'pointer-events-none opacity-40'}`} href={proxied ? `${proxied}&download=1&filename=${encodeURIComponent(filename)}` : undefined} download={filename} aria-disabled={!proxied}>
              <Download size={14} /> Download High-Res Asset
            </a>
          </div>
          <div className="flex min-h-[260px] items-center justify-center rounded-md border border-line p-3" style={{ backgroundImage: 'conic-gradient(#151B26 25%, #1E2638 0 50%, #151B26 0 75%, #1E2638 0)', backgroundSize: '16px 16px' }}>
            {proxied && !broken ? (
              <img src={proxied} alt="Asset preview" className="max-h-[360px] max-w-full object-contain" onError={() => setBroken(true)} />
            ) : (
              <span className="px-4 text-center text-xs text-muted">{broken ? "Couldn't load that image — check the host is allowlisted and the URL is right." : 'Preview'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
