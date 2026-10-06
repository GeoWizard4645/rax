import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { load, remove, save } from '../../lib/storage';
import { checkLogin, setPassword, signup } from '../../lib/rateboardClient';
import { MIN_PASS } from '../../../shared/rateboard';

const DEVICE_KEY = 'rax_rb_device_v1';

interface Device {
  key: string;
  name: string;
  ts: number;
}

interface Session {
  /** Display name, or null when signed out. */
  me: string | null;
  /** Lower-case key used on offers. */
  key: string | null;
  signIn: (username: string, password: string) => Promise<{ ok: true; notice?: string } | { ok: false; message: string }>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function RbSessionProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<Device | null>(() => load<Device | null>(DEVICE_KEY, null));

  const signIn = useCallback<Session['signIn']>(async (usernameRaw, password) => {
    const username = usernameRaw.trim();
    if (username.length < 2) return { ok: false, message: 'Enter your username.' };
    if (password.length < MIN_PASS) return { ok: false, message: `Password needs at least ${MIN_PASS} characters.` };
    let r;
    try {
      r = await checkLogin(username, password);
    } catch (e) {
      return { ok: false, message: `Something broke: ${(e as Error).message}` };
    }
    let notice: string | undefined;
    if (r.status === 'banned') return { ok: false, message: 'This account has been removed from the board.' };
    if (r.status === 'wrong') return { ok: false, message: 'Wrong password for that username.' };
    if (r.status === 'reset') {
      // Password was reset by the admin — whatever was just typed becomes it.
      const w = await setPassword(r.key, r.hash);
      if (!w.ok) return { ok: false, message: 'Could not set that password. Try again.' };
      notice = 'New password saved.';
    } else if (r.status === 'new') {
      const w = await signup(r.key, username, r.hash);
      if (!w.ok) return { ok: false, message: 'Could not create the account. Try again.' };
      notice = 'Account created on Rateboard.';
    }
    const d: Device = { key: r.key, name: r.status === 'new' ? username : r.name, ts: Date.now() };
    save(DEVICE_KEY, d);
    setDevice(d);
    return { ok: true, notice };
  }, []);

  const signOut = useCallback(() => {
    remove(DEVICE_KEY);
    setDevice(null);
  }, []);

  const value = useMemo<Session>(() => ({ me: device?.name ?? null, key: device?.key ?? null, signIn, signOut }), [device, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRbSession(): Session {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRbSession must be used inside RbSessionProvider');
  return c;
}
