import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { T, s } from '../tokens';
import { APP_NAME, COL } from '../config';
import { isHardcodedSuperadmin, ROLES } from '../roles';

// Wraps the app: handles login, then loads the user's role from
// bunkerops_users/{uid}. Hardcoded superadmins always get full access
// (break-glass). A logged-in user with no role doc is DENIED until an
// admin assigns one. Passes { user, role, signOut } to children (render prop).
export default function AuthGate({ children }) {
  const [user, setUser]   = useState(undefined); // undefined = still checking auth
  const [role, setRole]   = useState(undefined); // undefined = still loading role
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setRole(undefined); return; }
      if (isHardcodedSuperadmin(u.email)) { setRole('superadmin'); return; }
      try {
        const snap = await getDoc(doc(db, COL.users, u.uid));
        if (snap.exists() && snap.data().role && ROLES[snap.data().role]) {
          setRole(snap.data().role);
        } else {
          setRole(null); // logged in but no valid role → denied
        }
      } catch (e) {
        setRole(null);
      }
    });
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

  const shell = (inner) => (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center' }}>
      <div style={{ ...s.card, width: 340 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.amber, letterSpacing: 1, marginBottom: 2 }}>
          {APP_NAME}
        </div>
        <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginBottom: 20 }}>
          OB GALLEY · BUNKER OPS
        </div>
        {inner}
      </div>
    </div>
  );

  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center',
        color: T.textDim, fontFamily: T.font }}>Loading…</div>
    );
  }

  if (!user) {
    return shell(
      <>
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
      </>
    );
  }

  if (role === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center',
        color: T.textDim, fontFamily: T.font }}>Loading access…</div>
    );
  }

  if (role === null) {
    return shell(
      <>
        <div style={{ fontSize: 13, color: T.red, fontWeight: 600, marginBottom: 8 }}>No access assigned</div>
        <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.6, marginBottom: 16 }}>
          Your account <b>{user.email}</b> is signed in but has not been granted a role.
          Please contact a Superadmin or Director to be assigned access.
        </div>
        <button onClick={() => signOut(auth)} style={{ ...s.btn('ghost'), width: '100%' }}>SIGN OUT</button>
      </>
    );
  }

  return children({ user, role, signOut: () => signOut(auth) });
}
