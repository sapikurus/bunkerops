import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { T, s } from '../tokens';
import { APP_NAME } from '../config';

// Wraps the app: shows a login screen until a user is authenticated,
// then renders children. Uses the SAME Firebase Auth as FuelOps — your
// existing FuelOps account logs in here unchanged (same project).
export default function AuthGate({ children }) {
  const [user, setUser]       = useState(undefined); // undefined = still checking
  const [email, setEmail]     = useState('');
  const [pw, setPw]           = useState('');
  const [err, setErr]         = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  const login = async () => {
    setErr(''); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (e) {
      setErr(e.code === 'auth/invalid-credential'
        ? 'Wrong email or password.'
        : (e.code || e.message));
    } finally {
      setBusy(false);
    }
  };

  // Still checking auth state
  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center',
        color: T.textDim, fontFamily: T.font }}>Loading…</div>
    );
  }

  // Not logged in → login screen
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center' }}>
        <div style={{ ...s.card, width: 340 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.amber, letterSpacing: 1, marginBottom: 2 }}>
            {APP_NAME}
          </div>
          <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginBottom: 20 }}>
            OB GALLEY · BUNKER OPS
          </div>

          <label style={s.label}>Email</label>
          <input style={{ ...s.input, marginBottom: 12 }} type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()} />

          <label style={s.label}>Password</label>
          <input style={{ ...s.input, marginBottom: 16 }} type="password" value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()} />

          <button onClick={login} disabled={busy} style={{ ...s.btn('primary'), width: '100%' }}>
            {busy ? 'SIGNING IN…' : 'SIGN IN'}
          </button>

          {err && <div style={{ marginTop: 12, fontSize: 11, color: T.red }}>{err}</div>}

          <div style={{ marginTop: 16, fontSize: 10, color: T.textFaint, lineHeight: 1.6 }}>
            Use your FuelOps account — same login, same Firebase project.
          </div>
        </div>
      </div>
    );
  }

  // Logged in → render app, with a thin top bar showing the user + sign out
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
        padding: '6px 16px', background: T.card, borderBottom: `1px solid ${T.border}`,
        fontSize: 11, color: T.textDim }}>
        <span>{user.email}</span>
        <button onClick={() => signOut(auth)} style={{ ...s.btn('ghost'), padding: '4px 10px', fontSize: 10 }}>
          SIGN OUT
        </button>
      </div>
      {children}
    </div>
  );
}
