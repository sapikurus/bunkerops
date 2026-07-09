import { useState } from 'react';
import { T, s } from '../tokens';
import { COL } from '../config';
import { useCollection } from './useCollection';
import { ROLES, ROLE_ORDER, isHardcodedSuperadmin } from '../roles';

// Users & Roles: Superadmin/Director assign a role to a user by their Firebase
// Auth UID. Credentials are created manually in the Firebase console; this screen
// only grants the app-level role. Hardcoded superadmins can't be demoted/removed.
//
// A user doc: bunkerops_users/{uid} = { uid, email, role }
export default function UsersRoles({ role }) {
  const usersC = useCollection(COL.users);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);

  const BLANK = { uid: '', email: '', role: 'operator' };
  const startNew  = () => { setForm({ ...BLANK }); setEditId(null); };
  const startEdit = (u) => { setForm({ uid: u.uid || u.id, email: u.email || '', role: u.role || 'operator' }); setEditId(u.id); };
  const cancel = () => { setForm(null); setEditId(null); };
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.uid.trim())   { alert('Firebase Auth UID is required.'); return; }
    if (!form.email.trim()) { alert('Email is required.'); return; }
    if (isHardcodedSuperadmin(form.email)) {
      alert('This email is a permanent superadmin and does not need a role assignment.');
      return;
    }
    const payload = { uid: form.uid.trim(), email: form.email.trim().toLowerCase(), role: form.role };
    // Store keyed by UID so AuthGate can look it up as bunkerops_users/{uid}.
    await usersC.setWithId(form.uid.trim(), payload);
    cancel();
  };

  const del = async (u) => {
    if (isHardcodedSuperadmin(u.email)) { alert('Cannot remove a permanent superadmin.'); return; }
    if (!confirm(`Remove role for ${u.email}?`)) return;
    await usersC.remove(u.id);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: T.textDim, maxWidth: 620, lineHeight: 1.6 }}>
          Assign an app role to each user. Create the login itself in the Firebase console first, copy its
          <b> User UID</b> here, and grant a role. Superadmin/Director have full access; Supervisor manages
          orders and BAST; Operator views DO and fills BAST.
        </div>
        {!form && <button onClick={startNew} style={s.btn('primary')}>+ ADD USER ROLE</button>}
      </div>

      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 14 }}>
            {editId ? 'EDIT USER ROLE' : 'NEW USER ROLE'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Firebase Auth UID</label>
              <input style={s.input} value={form.uid} onChange={e => sf('uid', e.target.value)}
                placeholder="from Firebase console" disabled={!!editId} />
            </div>
            <div>
              <label style={s.label}>Email</label>
              <input style={s.input} value={form.email} onChange={e => sf('email', e.target.value)}
                placeholder="user@company.com" />
            </div>
            <div>
              <label style={s.label}>Role</label>
              <select style={s.input} value={form.role} onChange={e => sf('role', e.target.value)}>
                {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLES[r].label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={s.btn('primary')}>{editId ? 'SAVE' : 'GRANT ROLE'}</button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: T.textFaint, lineHeight: 1.6 }}>
            Find the UID in Firebase console → Authentication → Users → copy the User UID column.
          </div>
        </div>
      )}

      {usersC.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>EMAIL</th>
              <th style={s.th}>ROLE</th>
              <th style={s.th}>UID</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {usersC.data.map(u => (
              <tr key={u.id}>
                <td style={s.td}>{u.email}</td>
                <td style={s.td}><span style={{ color: T.amber }}>{ROLES[u.role]?.label || u.role}</span></td>
                <td style={{ ...s.td, fontFamily: T.font, fontSize: 10, color: T.textDim }}>{u.uid || u.id}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <button onClick={() => startEdit(u)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                  <button onClick={() => del(u)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
