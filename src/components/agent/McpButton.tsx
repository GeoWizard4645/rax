import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plug } from 'lucide-react';

const McpDialog = lazy(() => import('./McpDialog'));

/** Top-right header button that opens the "connect an AI app" dialog. `/?mcp=1` (what browsers visiting /mcp are redirected to) opens it on load. */
export default function McpButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('mcp')) {
      setOpen(true);
      p.delete('mcp');
      const q = p.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    }
  }, []);
  return (
    <>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Connect Instinct or any AI app to RAX over MCP">
        <Plug size={14} className="text-emerald" /> <span>MCP</span>
      </button>
      {/* portal: the header uses backdrop-blur, which would otherwise become the containing block of the modal's fixed overlay */}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <McpDialog onClose={() => setOpen(false)} />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
