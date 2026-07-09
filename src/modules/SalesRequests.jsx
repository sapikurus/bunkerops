import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, SCHEMES, ISSUERS, formatSoNumber } from '../config';
import { useCollection } from './useCollection';
import { allocateNumber } from './counters';
import VolumeInput from './VolumeInput';
import { useFuelOpsMaster } from './useFuelOpsMaster';

const todayISO = () => new Date().toISOString().slice(0, 10);

const BLANK = {
  galleyPoRef: '', clientId: '', entityId: '', vesselName: '',
  scheme: 'PPS_SALE', nodeId: '', fuelTypeId: '',
  requestedVolumeL: '', deliveryLocation: '', requestedDate: todayISO(),
  status: 'requested',
};

const STATUS_COLORS = {
  requested: T.blue, do_issued: T.amber, bast_done: '#a855f7', reconciled: T.green,
};

export default function SalesRequests() {
  const sr       = useCollection(COL.salesRequests);
  const clientsC = useCollection(COL.clients);
  const nodesC   = useCollection(COL.nodes);
  const { fuelTypes, error: ftError } = useFuelOpsMaster();

  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);

  const clients = clientsC.data;
  const nodes   = nodesC.data;

  // cascading option sources
  const selClient = useMemo(() => clients.find(c => c.id === form?.clientId), [clients, form?.clientId]);
  const entities  = selClient?.entities || [];
  const selEntity = useMemo(() => entities.find(e => e.id === form?.entityId), [entities, form?.entityId]);
  const vessels   = selEntity?.vessels || [];

  const scheme = form ? SCHEMES[form.scheme] : null;
  const derivedBucket = scheme?.bucket;
  const derivedIssuer = scheme ? ISSUERS[scheme.issuer]?.name : '';

  const startNew  = () => { setForm({ ...BLANK }); setEditId(null); };
  const startEdit = (r) => { setForm({ ...BLANK, ...r }); setEditId(r.id); };
  const cancel    = () => { setForm(null); setEditId(null); };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // when node changes, default the delivery location to the node's location (editable)
  const onNode = (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    setForm(f => ({ ...f, nodeId,
      deliveryLocation: f.deliveryLocation || (node?.location || '') }));
  };

  const save = async () => {
    if (!form.clientId || !form.entityId) { alert('Client and Entity are required.'); return; }
    if (!form.scheme || !form.nodeId)     { alert('Scheme and Node are required.'); return; }
    if (!form.requestedVolumeL)           { alert('Requested volume is required.'); return; }
    const ft = fuelTypes.find(f => f.id === form.fuelTypeId);
    const node = nodes.find(n => n.id === form.nodeId);
    let soNumber = form.soNumber;
    // Allocate an atomic SO number only on first creation.
    if (!editId) {
      const d = new Date(form.requestedDate);
      const seq = await allocateNumber('so', d.getFullYear());
      const issuerCode = ISSUERS[SCHEMES[form.scheme].issuer]?.code || 'PPS';
      soNumber = formatSoNumber({ seq, issuerCode, nodeCode: node?.code || '', monthIndex: d.getMonth(), year: d.getFullYear() });
    }
    const payload = {
      soNumber,
      galleyPoRef: form.galleyPoRef.trim(),
      clientId: form.clientId,
      clientName: selClient?.groupName || '',
      entityId: form.entityId,
      entityName: selEntity?.name || '',
      vesselName: form.vesselName,
      scheme: form.scheme,
      bucket: SCHEMES[form.scheme].bucket,
      issuerKey: SCHEMES[form.scheme].issuer,
      nodeId: form.nodeId,
      nodeName: node?.name || '',
      nodeCode: node?.code || '',
      fuelTypeId: form.fuelTypeId,
      fuelTypeName: ft?.name || '',
      fuelTypeShort: ft?.shortName || '',
      requestedVolumeL: Number(form.requestedVolumeL) || 0,
      deliveryLocation: form.deliveryLocation.trim(),
      requestedDate: form.requestedDate,
      status: form.status || 'requested',
    };
    if (editId) await sr.update(editId, payload);
    else        await sr.add(payload);
    cancel();
  };

  const del = async (r) => {
    if (!confirm('Delete this sales order?')) return;
    await sr.remove(r.id);
  };

  const fmtL = n => (Number(n) || 0).toLocaleString('id-ID');

  return (
    <div style={{ padding: 40, maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>SALES ORDERS</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
            The trigger document. Scheme choice drives bucket, DO issuer, and revenue treatment.
          </div>
        </div>
        {!form && <button onClick={startNew} style={s.btn('primary')}>+ NEW SALES ORDER</button>}
      </div>

      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 14 }}>
            {editId ? `EDIT ${form.soNumber || 'SALES ORDER'}` : 'NEW SALES ORDER'}
          </div>

          {/* Client cascade */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Client Group</label>
              <select style={s.input} value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value, entityId: '', vesselName: '' }))}>
                <option value="">— select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.groupName}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Entity</label>
              <select style={s.input} value={form.entityId} disabled={!selClient}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value, vesselName: '' }))}>
                <option value="">— select —</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Vessel</label>
              <select style={s.input} value={form.vesselName} disabled={!selEntity}
                onChange={e => sf('vesselName', e.target.value)}>
                <option value="">— select —</option>
                {vessels.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </div>
          </div>

          {/* Scheme + derived */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Scheme</label>
              <select style={s.input} value={form.scheme} onChange={e => sf('scheme', e.target.value)}>
                {Object.values(SCHEMES).map(sc => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6, gap: 16 }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: T.textDim }}>Bucket: </span>
                <span style={{ color: T.amber, fontWeight: 700 }}>{derivedBucket}</span>
              </div>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: T.textDim }}>DO Issuer: </span>
                <span style={{ color: T.amber, fontWeight: 700 }}>{derivedIssuer}</span>
              </div>
            </div>
          </div>

          {/* Node + fuel + volume */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Source Node</label>
              <select style={s.input} value={form.nodeId} onChange={e => onNode(e.target.value)}>
                <option value="">— select —</option>
                {nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.code})</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Fuel Type</label>
              {ftError ? (
                <input style={s.input} placeholder="type fuel (FuelOps list unavailable)"
                  value={form.fuelTypeName || ''} onChange={e => sf('fuelTypeName', e.target.value)} />
              ) : (
                <select style={s.input} value={form.fuelTypeId} onChange={e => sf('fuelTypeId', e.target.value)}>
                  <option value="">— select —</option>
                  {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label style={s.label}>Requested Volume (L)</label>
              <VolumeInput value={form.requestedVolumeL}
                onChange={v => sf('requestedVolumeL', v)} placeholder="21.000" />
            </div>
          </div>

          {/* Location + PO + date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Delivery Location</label>
              <input style={s.input} value={form.deliveryLocation}
                onChange={e => sf('deliveryLocation', e.target.value)} placeholder="IWIP" />
            </div>
            <div>
              <label style={s.label}>Galley PO Ref</label>
              <input style={s.input} value={form.galleyPoRef}
                onChange={e => sf('galleyPoRef', e.target.value)} placeholder="PO number" />
            </div>
            <div>
              <label style={s.label}>Requested Date</label>
              <input style={s.input} type="date" value={form.requestedDate}
                onChange={e => sf('requestedDate', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={s.btn('primary')}>{editId ? 'SAVE' : 'CREATE'}</button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {sr.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : sr.data.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No sales orders yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>SO NUMBER</th>
              <th style={s.th}>DATE</th>
              <th style={s.th}>CLIENT / ENTITY</th>
              <th style={s.th}>VESSEL</th>
              <th style={s.th}>SCHEME</th>
              <th style={s.th}>FUEL</th>
              <th style={{ ...s.th, textAlign: 'right' }}>VOLUME (L)</th>
              <th style={s.th}>STATUS</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {sr.data.map(r => (
              <tr key={r.id}>
                <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 10 }}>{r.soNumber || '—'}</td>
                <td style={s.td}>{r.requestedDate}</td>
                <td style={s.td}>
                  <div>{r.clientName}</div>
                  <div style={{ fontSize: 10, color: T.textDim }}>{r.entityName}</div>
                </td>
                <td style={s.td}>{r.vesselName || '—'}</td>
                <td style={s.td}>
                  <span style={{ fontSize: 10, color: r.scheme === 'PPS_SALE' ? T.green : T.blue }}>
                    {r.scheme === 'PPS_SALE' ? 'PPS Sale' : 'Non-PPS'} · {r.bucket}
                  </span>
                </td>
                <td style={s.td}>{r.fuelTypeShort || r.fuelTypeName || '—'}</td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(r.requestedVolumeL)}</td>
                <td style={s.td}>
                  <span style={{ fontSize: 10, color: STATUS_COLORS[r.status] || T.textDim }}>
                    {r.status}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <button onClick={() => startEdit(r)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                  <button onClick={() => del(r)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ftError && (
        <div style={{ marginTop: 16, fontSize: 10, color: T.textFaint }}>
          Note: couldn't load fuel types from FuelOps ({ftError}). Fuel type falls back to manual entry.
        </div>
      )}
    </div>
  );
}
