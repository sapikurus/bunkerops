import { useState, useMemo, Fragment } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS, NODES, CARGO_OWNER, formatDoNumber, formatBastNumber } from '../config';
import { useCollection } from './useCollection';
import { allocateNumber } from './counters';
import { buildDOHtml } from './doGen';
import VolumeInput from './VolumeInput';
import { USI_LOGO, PPS_LOGO } from './assets';
import { makeQR } from './qr';
import { usePagination, PaginationBar, useIsNarrow, diffSOtoDO, diffDOtoBAST } from './listUtils';

const todayISO = () => new Date().toISOString().slice(0, 10);
const romanMonth = (d) => new Date(d).getMonth();

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
  const [syncBusy, setSyncBusy] = useState({}); // per-DO id spinner

  const narrow = useIsNarrow();

  const openRequests = srC.data.filter(r => r.status === 'requested');

  // Newest first (brDate desc, brNo desc tiebreak).
  const sortedDOs = useMemo(() => {
    return [...doC.data].sort((a, b) => {
      const d = String(b.brDate || '').localeCompare(String(a.brDate || ''));
      if (d !== 0) return d;
      return String(b.brNo || '').localeCompare(String(a.brNo || ''));
    });
  }, [doC.data]);

  const pg = usePagination(sortedDOs, 20);

  const startFromRequest = (r) => {
    const node = nodesC.data.find(n => n.id === r.nodeId);
    setForm({
      salesRequestId: r.id,
      scheme: r.scheme,
      issuerKey: r.issuerKey,
      bucket: r.bucket,
      nodeId: r.nodeId,
      nodeCode: r.nodeCode || node?.code || '',
      deliverTo: r.entityName,
      deliverLocation: r.deliveryLocation,
      vesselName: r.vesselName,
      fuelDescription: r.fuelTypeName || r.fuelTypeShort || '',
      dispatchedVolumeL: r.requestedVolumeL,
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

  // Keep a blank BAST aligned with its DO. No-op if there's no blank BAST,
  // or if the BAST is already filled (returns 'skipped-filled' so the caller
  // can warn). Returns 'synced' | 'no-bast' | 'skipped-filled' | 'in-sync'.
  const syncBlankBAST = async (doId, doData) => {
    const bast = bastC.data.find(b => b.deliveryOrderId === doId);
    if (!bast) return 'no-bast';
    if (bast.status !== 'blank') {
      const diffs = diffDOtoBAST(doData, bast);
      return diffs.length ? 'skipped-filled' : 'in-sync';
    }
    const diffs = diffDOtoBAST(doData, bast);
    if (!diffs.length) return 'in-sync';
    const cargoOwner = CARGO_OWNER[doData.scheme] || ISSUERS[doData.issuerKey]?.name || '';
    await bastC.update(bast.id, {
      supplier:      { ...(bast.supplier || {}), name: cargoOwner, deliveryOrder: doData.brNo },
      recipient:     { ...(bast.recipient || {}), entityName: doData.deliverTo || '', vesselName: doData.vesselName || '' },
      deliveredFrom: { ...(bast.deliveredFrom || {}), facility: doData.deliveredFrom || '', port: doData.nodePort ?? bast.deliveredFrom?.port ?? '' },
      dispatchedVolumeL: Number(doData.dispatchedVolumeL) || 0,
      penyalur:      { ...(bast.penyalur || {}), quantity: String(Number(doData.dispatchedVolumeL) || 0) },
    });
    return 'synced';
  };

  const save = async () => {
    if (busy) return;
    if (!form.dispatchedVolumeL) { alert('Dispatched volume is required.'); return; }
    setBusy(true);
    try {
      let brNo = form.brNo;
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
        nodePort: form.nodePort || '',
        clientPoRef: form.clientPoRef || '',
        signers: form.signers,
        status: form.status || 'issued',
      };
      if (editId) {
        await doC.update(editId, payload);
        // Item 2: propagate DO edits into its blank BAST automatically.
        const res = await syncBlankBAST(editId, { ...payload, id: editId });
        if (res === 'skipped-filled') {
          alert('DO saved. Its BAST is already filled, so it was NOT auto-updated — open the BAST and use "Sync from DO" if you intend to overwrite the handover record.');
        }
      } else {
        const doRef = await doC.add(payload);
        if (form.salesRequestId) await srC.update(form.salesRequestId, { status: 'do_issued' });
        const year = new Date(form.brDate).getFullYear();
        const bseq = await allocateNumber('bast', year);
        const nomorBast = formatBastNumber({ seq: bseq, monthIndex: romanMonth(form.brDate), year });
        const cargoOwner = CARGO_OWNER[form.scheme] || ISSUERS[form.issuerKey]?.name || '';
        await bastC.add({
          deliveryOrderId: doRef.id,
          nomorBast,
          tanggalBast: form.brDate,
          supplier:    { name: cargoOwner, deliveryOrder: brNo },
          penyalur:    { name: ISSUERS.USI_PTS.name, vesselName: '', nakhoda: '', quantity: String(Number(form.dispatchedVolumeL) || 0) },
          recipient:   { entityName: form.deliverTo || '', vesselName: form.vesselName || '', receiverName: '' },
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
          status: 'blank',
        });
      }
      cancel();
    } catch (e) {
      alert('Error saving DO: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Item 1: apply parent-SO changes to an out-of-sync DO ----
  const applySOtoDO = async (d, so, diffs) => {
    const breaks = diffs.filter(x => x.breaksNumber);
    let msg = `Apply ${diffs.length} change(s) from SO ${so.soNumber} to DO ${d.brNo}?`;
    if (breaks.length) {
      msg += `\n\nWARNING: ${breaks.map(b => b.label).join(', ')} changed. ` +
             `These are encoded in the DO number (${d.brNo}), which will NOT be renumbered automatically. ` +
             `The document number will no longer match its scheme/node. Continue anyway?`;
    }
    if (!confirm(msg)) return;

    setSyncBusy(m => ({ ...m, [d.id]: true }));
    try {
      const patch = {};
      const node = nodesC.data.find(n => n.id === so.nodeId);
      for (const diff of diffs) {
        switch (diff.field) {
          case 'deliverTo':        patch.deliverTo = so.entityName || ''; break;
          case 'deliverLocation':  patch.deliverLocation = so.deliveryLocation || ''; break;
          case 'vesselName':       patch.vesselName = so.vesselName || ''; break;
          case 'fuelDescription':  patch.fuelDescription = so.fuelTypeName || so.fuelTypeShort || ''; break;
          case 'dispatchedVolumeL':patch.dispatchedVolumeL = Number(so.requestedVolumeL) || 0; break;
          case 'scheme':           patch.scheme = so.scheme; patch.issuerKey = so.issuerKey; break;
          case 'bucket':           patch.bucket = so.bucket; break;
          case 'nodeId':
            patch.nodeId = so.nodeId;
            patch.nodeCode = so.nodeCode || node?.code || '';
            patch.deliveredFrom = so.nodeName || node?.name || '';
            patch.nodePort = node?.location || d.nodePort || '';
            break;
          default: break;
        }
      }
      // keep items[0].description + qty in step with fuel/volume
      const nextFuel = patch.fuelDescription ?? d.fuelDescription ?? d.items?.[0]?.description ?? '-';
      const nextVol  = patch.dispatchedVolumeL ?? d.dispatchedVolumeL ?? 0;
      patch.items = [{ no: 1, description: nextFuel || '-', qtyLiters: Number(nextVol) || 0 }];

      const merged = { ...d, ...patch };
      await doC.update(d.id, patch);
      // cascade into the blank BAST
      const res = await syncBlankBAST(d.id, merged);
      if (res === 'skipped-filled') {
        alert('DO updated. Its BAST is already filled and was left untouched — sync it manually from the BAST screen if needed.');
      }
    } catch (e) {
      alert('Error applying SO changes: ' + e.message);
    } finally {
      setSyncBusy(m => ({ ...m, [d.id]: false }));
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

  // Compute discrepancy list for a DO against its parent SO.
  const diffsFor = (d) => {
    if (!d.salesRequestId) return [];
    const so = srC.data.find(r => r.id === d.salesRequestId);
    if (!so) return [];
    return diffSOtoDO(so, d);
  };
  const soFor = (d) => srC.data.find(r => r.id === d.salesRequestId);

  // Reusable out-of-sync banner (used in both table and card views, and editor).
  const SyncBanner = ({ d }) => {
    const diffs = diffsFor(d);
    if (!diffs.length) return null;
    const so = soFor(d);
    const breaks = diffs.some(x => x.breaksNumber);
    return (
      <div style={{
        border: `1px solid ${T.amber}`, borderRadius: 4, padding: '10px 12px', marginTop: 8,
        background: T.amberGlow,
      }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 6 }}>
          ⚠ OUT OF SYNC WITH SO {so?.soNumber || ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
          {diffs.map((x, i) => (
            <div key={i} style={{ fontSize: 11, color: T.text, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ color: T.textDim, minWidth: 96 }}>{x.label}{x.breaksNumber ? ' *' : ''}:</span>
              <span style={{ color: T.red, textDecoration: 'line-through' }}>{String(x.doVal ?? '—') || '—'}</span>
              <span style={{ color: T.textFaint }}>→</span>
              <span style={{ color: T.green }}>{String(x.so ?? '—') || '—'}</span>
            </div>
          ))}
        </div>
        {breaks && (
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 8 }}>
            * encoded in the DO number — applying will not renumber the document.
          </div>
        )}
        <button
          onClick={() => applySOtoDO(d, so, diffs)}
          disabled={syncBusy[d.id]}
          style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 10 }}
        >
          {syncBusy[d.id] ? 'APPLYING…' : 'APPLY SO CHANGES →'}
        </button>
      </div>
    );
  };

  return (
    <div style={{ padding: narrow ? 16 : 40, maxWidth: 1000 }}>
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
              gap: 10, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
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

          {/* Show live out-of-sync banner while editing an existing DO */}
          {editId && <div style={{ marginBottom: 14 }}><SyncBanner d={doC.data.find(x => x.id === editId) || form} /></div>}

          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
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
      ) : narrow ? (
        // -------- Mobile: stacked cards --------
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pg.pageRows.map(d => (
            <div key={d.id} style={{ ...s.card, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: T.font, color: T.amber, fontSize: 11 }}>{d.brNo}</span>
                <span style={{ fontSize: 10, color: T.textDim }}>{d.status}</span>
              </div>
              <div style={{ fontSize: 13, color: T.text }}>{d.deliverTo}</div>
              <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <span>{d.brDate}</span>
                <span>· {d.vesselName || '—'}</span>
                <span style={{ fontFamily: T.font }}>· {fmtL(d.dispatchedVolumeL)} L</span>
              </div>
              <SyncBanner d={d} />
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => printDO(d)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>PDF</button>
                <button onClick={() => startEdit(d)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>EDIT</button>
                <button onClick={() => del(d)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10, color: T.red }}>DEL</button>
              </div>
            </div>
          ))}
          <PaginationBar {...pg} />
        </div>
      ) : (
        // -------- Desktop: table (banner spans full width under the row) --------
        <>
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
              {pg.pageRows.map(d => {
                const diffs = diffsFor(d);
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>
                        {d.brNo}
                        {diffs.length > 0 && <span title="Out of sync with SO" style={{ color: T.amber, marginLeft: 6 }}>⚠</span>}
                      </td>
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
                    {diffs.length > 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 12px 10px', borderBottom: `1px solid ${T.border}` }}>
                          <SyncBanner d={d} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <PaginationBar {...pg} />
        </>
      )}
    </div>
  );
}
