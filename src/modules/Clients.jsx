import { useState } from 'react';
import { T, s } from '../tokens';
import { COL } from '../config';
import { useCollection } from './useCollection';

// Client document shape:
// { id, groupName, poIssuer, entities: [ { id, name, vessels: [ {id, name} ] } ], active }

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Clients() {
  const { data: clients, loading, add, update, remove } = useCollection(COL.clients);
  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);

  const BLANK = { groupName: '', poIssuer: '', entities: [], active: true };

  const startNew  = () => { setForm({ ...BLANK, entities: [] }); setEditId(null); };
  const startEdit = (c) => {
    // deep clone so edits don't mutate the live list
    setForm(JSON.parse(JSON.stringify({ groupName: c.groupName || '', poIssuer: c.poIssuer || '',
      entities: c.entities || [], active: c.active !== false })));
    setEditId(c.id);
  };
  const cancel = () => { setForm(null); setEditId(null); };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // entity ops
  const addEntity = () =>
    setForm(f => ({ ...f, entities: [...f.entities, { id: uid(), name: '', vessels: [] }] }));
  const setEntity = (ei, name) =>
    setForm(f => { const e = [...f.entities]; e[ei] = { ...e[ei], name }; return { ...f, entities: e }; });
  const delEntity = (ei) =>
    setForm(f => ({ ...f, entities: f.entities.filter((_, i) => i !== ei) }));

  // vessel ops (nested under an entity)
  const addVessel = (ei) =>
    setForm(f => { const e = [...f.entities];
      e[ei] = { ...e[ei], vessels: [...(e[ei].vessels || []), { id: uid(), name: '' }] };
      return { ...f, entities: e }; });
  const setVessel = (ei, vi, name) =>
    setForm(f => { const e = [...f.entities]; const v = [...e[ei].vessels];
      v[vi] = { ...v[vi], name }; e[ei] = { ...e[ei], vessels: v }; return { ...f, entities: e }; });
  const delVessel = (ei, vi) =>
    setForm(f => { const e = [...f.entities];
      e[ei] = { ...e[ei], vessels: e[ei].vessels.filter((_, i) => i !== vi) };
      return { ...f, entities: e }; });

  const save = async () => {
    if (!form.groupName.trim()) { alert('Group name is required.'); return; }
    // clean empties
    const entities = (form.entities || [])
      .filter(e => e.name.trim())
      .map(e => ({
        id: e.id, name: e.name.trim(),
        vessels: (e.vessels || []).filter(v => v.name.trim()).map(v => ({ id: v.id, name: v.name.trim() })),
      }));
    const payload = {
      groupName: form.groupName.trim(),
      poIssuer:  form.poIssuer.trim(),
      entities,
      active: form.active !== false,
    };
    if (editId) await update(editId, payload);
    else        await add(payload);
    cancel();
  };

  const del = async (c) => {
    if (!confirm(`Delete client group "${c.groupName}" and all its entities/vessels?`)) return;
    await remove(c.id);
  };

  return (
    <div style={{ padding: 40, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>CLIENTS</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
            Group → Entities → Vessels. E.g. MBSS → PT Aman Maritim Nusantara → Sereia 75.
          </div>
        </div>
        {!form && <button onClick={startNew} style={s.btn('primary')}>+ NEW CLIENT GROUP</button>}
      </div>

      {/* Editor */}
      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 14 }}>
            {editId ? 'EDIT CLIENT GROUP' : 'NEW CLIENT GROUP'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Group Name</label>
              <input style={s.input} value={form.groupName} onChange={e => sf('groupName', e.target.value)}
                placeholder="MBSS Group" />
            </div>
            <div>
              <label style={s.label}>PO Issuer (holding co.)</label>
              <input style={s.input} value={form.poIssuer} onChange={e => sf('poIssuer', e.target.value)}
                placeholder="PT. GALLEY ADHIKA ARNAWAMA" />
            </div>
          </div>

          {/* Entities */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>ENTITIES</div>
          {form.entities.map((ent, ei) => (
            <div key={ent.id} style={{ border: `1px solid ${T.border}`, borderRadius: 4, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input style={{ ...s.input, flex: 1 }} value={ent.name}
                  onChange={e => setEntity(ei, e.target.value)}
                  placeholder="PT Aman Maritim Nusantara" />
                <button onClick={() => delEntity(ei)}
                  style={{ ...s.btn('ghost'), padding: '6px 10px', fontSize: 11, color: T.red }}>✕ Entity</button>
              </div>
              {/* Vessels under this entity */}
              <div style={{ paddingLeft: 16 }}>
                <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginBottom: 6 }}>VESSELS</div>
                {(ent.vessels || []).map((v, vi) => (
                  <div key={v.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input style={{ ...s.input, flex: 1 }} value={v.name}
                      onChange={e => setVessel(ei, vi, e.target.value)}
                      placeholder="Sereia 75" />
                    <button onClick={() => delVessel(ei, vi)}
                      style={{ ...s.btn('ghost'), padding: '6px 10px', fontSize: 11, color: T.red }}>✕</button>
                  </div>
                ))}
                <button onClick={() => addVessel(ei)}
                  style={{ ...s.btn('ghost'), padding: '4px 10px', fontSize: 10, marginTop: 2 }}>+ vessel</button>
              </div>
            </div>
          ))}
          <button onClick={addEntity}
            style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 11, marginBottom: 16 }}>+ Entity</button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={s.btn('primary')}>{editId ? 'SAVE' : 'CREATE'}</button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : clients.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No client groups yet.</div>
      ) : (
        clients.map(c => (
          <div key={c.id} style={{ ...s.card, marginBottom: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, color: T.text, fontWeight: 700 }}>{c.groupName}</div>
                {c.poIssuer && <div style={{ fontSize: 10, color: T.textDim, marginTop: 2 }}>PO: {c.poIssuer}</div>}
              </div>
              <div>
                <button onClick={() => startEdit(c)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                <button onClick={() => del(c)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
              </div>
            </div>
            <div style={{ marginTop: 10, paddingLeft: 4 }}>
              {(c.entities || []).length === 0
                ? <div style={{ fontSize: 11, color: T.textFaint }}>No entities.</div>
                : c.entities.map(ent => (
                  <div key={ent.id} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: T.text }}>{ent.name}</span>
                    {(ent.vessels || []).length > 0 && (
                      <span style={{ fontSize: 11, color: T.textDim }}>
                        {' — '}{ent.vessels.map(v => v.name).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
