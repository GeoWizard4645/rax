import { ChevronDown, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** Collapsible "How this works" box. */
export function Explain({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info size={15} className="text-action" />
        <span className="flex-1">{title}</span>
        <ChevronDown size={15} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-2 border-t border-line px-3 py-3 text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
