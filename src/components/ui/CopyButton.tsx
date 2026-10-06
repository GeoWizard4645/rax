import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { useToast } from './Toast';

export function CopyButton({ text, label = 'Copy', disabled, className = 'btn-ghost btn-sm', toast = 'Copied' }: { text: string; label?: string; disabled?: boolean; className?: string; toast?: string }) {
  const [done, setDone] = useState(false);
  const notify = useToast();
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={async () => {
        const ok = await copyText(text);
        notify(ok ? toast : 'Could not copy — select the text and copy it manually', ok ? 'info' : 'error');
        if (ok) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {label}
    </button>
  );
}
