import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Notify = (msg: string, kind?: 'info' | 'error') => void;
const Ctx = createContext<Notify>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: 'info' | 'error'; id: number } | null>(null);
  const timer = useRef<number>();
  const notify = useCallback<Notify>((msg, kind = 'info') => {
    window.clearTimeout(timer.current);
    setT({ msg, kind, id: Date.now() });
    timer.current = window.setTimeout(() => setT(null), 3600);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      {t && (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw] rounded-md border px-4 py-2 text-sm shadow-xl ${
            t.kind === 'error' ? 'bg-surface border-danger/50 text-danger' : 'bg-surface border-line text-head'
          }`}
        >
          {t.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
