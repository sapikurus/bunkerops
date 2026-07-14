import { useState } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS, NODES, CARGO_OWNER, formatDoNumber, formatBastNumber } from '../config';
import { useCollection } from './useCollection';
import { allocateNumber } from './counters';
import { buildDOHtml } from './doGen';
import VolumeInput from './VolumeInput';
import { USI_LOGO, PPS_LOGO } from './assets';
import { makeQR } from './qr';

const todayISO = () => new Date().toISOString().slice(0, 10);
const romanMonth = (d) => new Date(d).getMonth();

// Default signer roles matching the sample DO.
const DEFAULT_SIGNERS = {
  issuedBy:   { role: 'Operation Bunker', name: '' },
  approvedBy: { role: 'Fuel Operations',  name: '' },
  deliveryBy: { role: 'Barge Master',     name: '' },
  receivedBy: { role: 'Tug Boat/Receiver',name: '' },
};

function openPrint(html) {
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

export default function DeliveryOrders() {
  const doC     = useCollection(COL.deliveryOrders);
  const srC     = useCollection(COL.salesRequests);
  const nodesC  = useCollection(COL.nodes);
  const bastC   = useCollection(COL.bast);

  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy]     = useState(false);

  // sales requests not yet turned into a DO
  const openRequests = srC.data.filter(r => r.status === 'requested');

  const startFromRequest = (r) => {
    const node = nodesC.data.find(n => n.id === r.nodeId);
    setForm({
      salesRequestId: r.id,
      scheme: r.scheme,
      issuerKey: r.issuerKey,       // derived at sales-order time
      bucket: r.bucket,
      nodeId: r.nodeId,
      nodeCode: r.nodeCode || node?.code || '',
      deliverTo: r.entityName,
      deliverLocation: r.deliveryLocation,
      vesselName: r.vesselName,
      fuelDescription: r.fuelTypeName || r.fuelTypeShort || '',
      dispatchedVolumeL: r.requestedVolumeL,   // editable — actual dispatched
      soNumber: r.soNumber || '',
      deliveredFrom: r.nodeName || node?.name || '',
      nodePort: node?.location || '',
      clientPoRef: r.galleyPoRef || '',
      brDate: todayISO(),
      estDeliveryDate: '',
      note: '-',
      signers: JSON.parse(JSON.stringify(DEFAULT_SIGNERS)),
    });
    setEditId(null);
  };

  const startEdit = (d) => { setForm(JSON.parse(JSON.stringify(d))); setEditId(d.id); };
  const cancel = () => { setForm(null); setEditId(null); };
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSigner = (who, field, v) =>
    setForm(f => ({ ...f, signers: { ...f.signers, [who]: { ...f.signers[who], [field]: v } } }));

  const save = async () => {
    if (busy) return;
    if (!form.dispatchedVolumeL) { alert('Dispatched volume is required.'); return; }
    setBusy(true);
    try {
      let brNo = form.brNo;
      // Allocate an atomic DO number only on first creation (not on edit).
      if (!editId) {
        const year = new Date(form.brDate).getFullYear();
        const monthIndex = romanMonth(form.brDate);
        const seq = await allocateNumber('do', year);
        const issuerCode = ISSUERS[form.issuerKey]?.code || 'PPS';
        brNo = formatDoNumber({ seq, issuerCode, nodeCode: form.nodeCode, monthIndex, year });
      }
      const payload = {
        salesRequestId: form.salesRequestId,
        brNo,
        brDate: form.brDate,
        issuerKey: form.issuerKey,
        scheme: form.scheme,
        bucket: form.bucket,
        nodeId: form.nodeId,
        nodeCode: form.nodeCode,
        deliverTo: form.deliverTo,
        deliverLocation: form.deliverLocation,
        vesselName: form.vesselName,
        items: [{ no: 1, description: form.fuelDescription || '-', qtyLiters: Number(form.dispatchedVolumeL) || 0 }],
        dispatchedVolumeL: Number(form.dispatchedVolumeL) || 0,
        estDeliveryDate: form.estDeliveryDate || '',
        note: form.note || '-',
        soNumber: form.soNumber || '',
        deliveredFrom: form.deliveredFrom || '',
        clientPoRef: form.clientPoRef || '',
        signers: form.signers,
        status: 'issued',
      };
      if (editId) {
        await doC.update(editId, payload);
      } else {
        const doRef = await doC.add(payload);
        if (form.salesRequestId) await srC.update(form.salesRequestId, { status: 'do_issued' });
        // Auto-create a BLANK BAST alongside the DO (printable pre-bunker; filled after loading).
        const year = new Date(form.brDate).getFullYear();
        const bseq = await allocateNumber('bast', year);
        const nomorBast = formatBastNumber({ seq: bseq, monthIndex: romanMonth(form.brDate), year });
        const cargoOwner = CARGO_OWNER[form.scheme] || ISSUERS[form.issuerKey]?.name || '';
        await bastC.add({
          deliveryOrderId: doRef.id,
          nomorBast,
          tanggalBast: form.brDate,
          // Supplier = cargo owner (scheme-driven)
          supplier:    { name: cargoOwner, deliveryOrder: brNo },
          // Penyalur = distributor (USI PTS by default) + transport vessel/nakhoda
          penyalur:    { name: ISSUERS.USI_PTS.name, vesselName: '', nakhoda: '', quantity: String(Number(form.dispatchedVolumeL) || 0) },
          // Recipient = client entity + receiving vessel (from the DO)
          recipient:   { entityName: form.deliverTo || '', vesselName: form.vesselName || '', receiverName: '' },
          // Delivered From = source node facility + port (node location)
          deliveredFrom: { facility: form.deliveredFrom || '', port: form.nodePort || '' },
          qty: { volumeObserved: '', literStandard: '', shoreTank: '', fmAwal: '', fmAkhir: '', suhu: '', density: '', waterContent: '', jamStart: '', jamEnd: '' },
          uom: 'Liter',
          note: '',
          transitLossL: null,
          dispatchedVolumeL: Number(form.dispatchedVolumeL) || 0,
          signers: {
            diserahkan: { name: '', role: 'Master / Chef Officer' },
            diterima:   { name: '', role: 'Penerima' },
            diketahui:  { name: '', role: 'SpV USIPTS' },
          },
          status: 'blank',   // 'blank' = printed pre-bunker; 'bast_done' = filled post-bunker
        });
      }
      cancel();
    } catch (e) {
      alert('Error saving DO: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const printDO = async (d) => {
    const issuerLogo = d.issuerKey === 'USI_PTS' ? USI_LOGO : PPS_LOGO;
    let qrDataUrl = '';
    try { qrDataUrl = await makeQR('do', d.id); } catch (e) { /* QR optional */ }
    const html = buildDOHtml({
      issuerKey: d.issuerKey,
      issuerLogo,
      brNo: d.brNo,
      brDate: d.brDate,
      deliverTo: d.deliverTo,
      deliverLocation: d.deliverLocation,
      vesselName: d.vesselName,
      items: d.items,
      estDeliveryDate: d.estDeliveryDate || '-',
      note: d.note,
      soNumber: d.soNumber,
      deliveredFrom: d.deliveredFrom,
      clientPoRef: d.clientPoRef,
      qrDataUrl,
      verifyCode: d.brNo,
      scheme: d.scheme,
      signers: d.signers,
    });
    openPrint(html);
  };

  const del = async (d) => {
    if (!confirm(`Delete DO ${d.brNo}? The sales request will revert to 'requested'.`)) return;
    await doC.remove(d.id);
    if (d.salesRequestId) await srC.update(d.salesRequestId, { status: 'requested' });
  };

  const fmtL = n => (Number(n) || 0).toLocaleString('id-ID');

  return (
    <div style={{ padding: 40, maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>DELIVERY ORDERS</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          Issued from a sales request. DO number is allocated atomically (no duplicates). Issuer follows the scheme.
        </div>
      </div>

      {/* Open requests to convert */}
      {!form && openRequests.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            OPEN SALES REQUESTS — ISSUE A DO
          </div>
          {openRequests.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: T.text }}>{r.entityName}</span>
                <span style={{ color: T.textDim }}> · {r.vesselName} · {r.fuelTypeShort} · {fmtL(r.requestedVolumeL)} L</span>
                <span style={{ color: r.scheme === 'PPS_SALE' ? T.green : T.blue, fontSize: 10 }}>
                  {' '}({r.scheme === 'PPS_SALE' ? 'PPS' : 'Non-PPS'})
                </span>
              </div>
              <button onClick={() => startFromRequest(r)} style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 10 }}>
                ISSUE DO →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 4 }}>
            {editId ? `EDIT DO ${form.brNo || ''}` : 'NEW DELIVERY ORDER'}
          </div>
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 14 }}>
            Issuer: <span style={{ color: T.amber }}>{ISSUERS[form.issuerKey]?.name}</span>
            {' · '}Node: <span style={{ color: T.amber }}>{form.nodeCode}</span>
            {' · '}Bucket: <span style={{ color: T.amber }}>{form.bucket}</span>
            {!editId && <span> · DO number allocated on save</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Deliver To</label>
              <input style={s.input} value={form.deliverTo} onChange={e => sf('deliverTo', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Location</label>
              <input style={s.input} value={form.deliverLocation} onChange={e => sf('deliverLocation', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Vessel</label>
              <input style={s.input} value={form.vesselName} onChange={e => sf('vesselName', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Fuel Description</label>
              <input style={s.input} value={form.fuelDescription} onChange={e => sf('fuelDescription', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Dispatched (L)</label>
              <VolumeInput value={form.dispatchedVolumeL}
                onChange={v => sf('dispatchedVolumeL', v)} placeholder="21.000" />
            </div>
            <div>
              <label style={s.label}>BR Date</label>
              <input style={s.input} type="date" value={form.brDate} onChange={e => sf('brDate', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Est. Delivery</label>
              <input style={s.input} type="date" value={form.estDeliveryDate}
                onChange={e => sf('estDeliveryDate', e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={s.label}>Note</label>
            <input style={s.input} value={form.note} onChange={e => sf('note', e.target.value)} />
          </div>

          {/* Signers */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>SIGNERS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['issuedBy','Issued By'],['approvedBy','Approved By'],['deliveryBy','Delivery By'],['receivedBy','Received By']].map(([who,lbl]) => (
              <div key={who}>
                <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 4 }}>{lbl}</div>
                <input style={{ ...s.input, marginBottom: 4 }} value={form.signers[who].role}
                  onChange={e => setSigner(who, 'role', e.target.value)} placeholder="role" />
                <input style={s.input} value={form.signers[who].name}
                  onChange={e => setSigner(who, 'name', e.target.value)} placeholder="name" />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={busy} style={s.btn('primary')}>
              {busy ? 'SAVING…' : (editId ? 'SAVE' : 'CREATE DO')}
            </button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {doC.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : doC.data.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No delivery orders yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>DO NUMBER</th>
              <th style={s.th}>DATE</th>
              <th style={s.th}>DELIVER TO</th>
              <th style={s.th}>VESSEL</th>
              <th style={{ ...s.th, textAlign: 'right' }}>DISPATCHED (L)</th>
              <th style={s.th}>STATUS</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {doC.data.map(d => (
              <tr key={d.id}>
                <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>{d.brNo}</td>
                <td style={s.td}>{d.brDate}</td>
                <td style={s.td}>{d.deliverTo}</td>
                <td style={s.td}>{d.vesselName}</td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(d.dispatchedVolumeL)}</td>
                <td style={s.td}><span style={{ fontSize: 10, color: T.textDim }}>{d.status}</span></td>
                <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => printDO(d)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>PDF</button>
                  <button onClick={() => startEdit(d)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
                  <button onClick={() => del(d)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
