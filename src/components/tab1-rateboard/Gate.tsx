import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useRbSession } from './useRbSession';
import { useToast } from '../ui/Toast';
import { Spinner } from '../ui/StateBlock';

/** Rateboard's sign-in: "New username signs you up. Returning username signs you in." */
export default function Gate() {
  const { signIn } = useRbSession();
  const notify = useToast();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setMsg('');
    const r = await signIn(user, pass);
    setBusy(false);
    if (!r.ok) setMsg(r.message);
    else if (r.notice) notify(r.notice);
  };

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Sign in to Rateboard</h2>
      </div>
      <form
        className="panel-bd space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <p className="hint">Standing buy offers for CFB, FC, NFL, UFC and NHL cards. Post what you'll pay, or pull your cards and see who's paying most.</p>
        <div>
          <label className="label" htmlFor="rb-user">
            Your in-game username
          </label>
          <input id="rb-user" className="field" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Exactly as it appears in the app" />
        </div>
        <div>
          <label className="label" htmlFor="rb-pass">
            Board password
          </label>
          <input id="rb-pass" className="field" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" placeholder="At least 4 characters" />
        </div>
        <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90">
          Don't reuse your real account password. This password is only for the Rateboard board and it protects nothing else. Pick something you use nowhere else.
        </div>
        {msg && (
          <div className="text-sm text-danger" role="alert">
            {msg}
          </div>
        )}
        <button className="btn-primary w-full" disabled={busy} type="submit">
          {busy ? <Spinner /> : <LogIn size={14} />} Continue
        </button>
        <p className="hint">New username signs you up on Rateboard. Returning username signs you in.</p>
      </form>
    </div>
  );
}
