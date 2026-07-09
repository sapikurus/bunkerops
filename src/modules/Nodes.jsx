import { useState } from 'react';
import { T, s } from '../tokens';
import { COL } from '../config';
import { useCollection } from './useCollection';

const NODE_TYPES = [
  { value: 'floating_storage', label: 'Floating Storage' },
  { value: 'spob',             label: 'SPOB (shuttle)' },
];

const BLANK = { name: '', code: '', type: 'floating_storage', location: '', active: true };

export default function Nodes({ embedded } = {}) {
  const { data: nodes, loading, add, update, remove } = useCollection(COL.nodes);
  const [form, setForm]     = useState(null);   // null = not editing; obj = editing/creating
  const [editId, setEditId] = useState(null);

  const startNew  = () => { setForm({ ...BLANK }); setEditId(null); };
  const startEdit = (n) => { setForm({ ...n }); setEditId(n.id); };
  const cancel    = () => { setForm(null); setEditId(null); };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) { alert('Name and Code are required.'); return; }
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      type: form.type,
      location: form.location.trim(),
      active: form.active !== false,
    };
    if (editId) await update(editId, payload);
    else        await add(payload);
    cancel();
  };

  const del = async (n) => {
    if (!confirm(`Delete node "${n.name}"? This cannot be undone.`)) return;
    await remove(n.id);
  };

  return (
    <div style={{ padding: embedded ? 0 : 40, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>STORAGE NODES</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
            Floating storage & shuttle vessels. The <strong>code</strong> (e.g. OBG) appears in DO numbers.
          </div>
        </div>
        {!form && <button onClick={startNew} style={s.btn('primary')}>+ NEW NODE</button>}
      </div>

      {/* Editor */}
      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 14 }}>
            {editId ? 'EDIT NODE' : 'NEW NODE'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Name</label>
              <input style={s.input} value={form.name} onChange={e => sf('name', e.target.value)}
                placeholder="OB Galley" />
            </div>
            <div>
              <label style={s.label}>Code (for DO#)</label>
              <input style={s.input} value={form.code} onChange={e => sf('code', e.target.value.toUpperCase())}
                placeholder="OBG" maxLength={5} />
            </div>
            <div>
              <label style={s.label}>Type</label>
              <select style={s.input} value={form.type} onChange={e => sf('type', e.target.value)}>
                {NODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Location</label>
              <input style={s.input} value={form.location} onChange={e => sf('location', e.target.value)}
                placeholder="Morowali" />
            </div>
            <div>
              <label style={s.label}>Active</label>
              <select style={s.input} value={form.active ? 'yes' : 'no'}
                onChange={e => sf('active', e.target.value === 'yes')}>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={s.btn('primary')}>{editId ? 'SAVE' : 'CREATE'}</button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : nodes.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>
          No nodes yet. Add OB Galley to begin.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>NAME</th>
              <th style={s.th}>CODE</th>
              <th style={s.th}>TYPE</th>
              <th style={s.th}>LOCATION</th>
              <th style={s.th}>STATUS</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {nodes.map(n => (
              <tr key={n.id}>
                <td style={s.td}>{n.name}</td>
                <td style={{ ...s.td, fontFamily: T.font, color: T.amber }}>{n.code}</td>
                <td style={s.td}>{NODE_TYPES.find(t => t.value === n.type)?.label || n.type}</td>
                <td style={s.td}>{n.location || '—'}</td>
                <td style={s.td}>
                  <span style={{ color: n.active !== false ? T.green : T.textFaint }}>
                    {n.active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <button onClick={() => startEdit(n)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                  <button onClick={() => del(n)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
