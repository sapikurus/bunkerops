import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS, CARGO_OWNER } from '../config';
import { useCollection } from './useCollection';
import { buildBASTHtml } from './bastGen';
import VolumeInput from './VolumeInput';
import { USI_LOGO } from './assets';
import { makeQR } from './qr';
import { usePagination, PaginationBar, useIsNarrow, diffDOtoBAST } from './listUtils';

const todayISO = () => new Date().toISOString().slice(0, 10);
const INDO_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const INDO_DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

// Leading BAST sequence number for tiebreak sorting ("022/PTS/BAST/VIII/26" -> 22).
const bastSeq = (b) => {
  const m = String(b?.nomorBast || '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

function openPrint(html) {
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 400);
}

export default function BASTModule() {
  const bastC = useCollection(COL.bast);
  const doC   = useCollection(COL.deliveryOrders);
  const srC   = useCollection(COL.salesRequests);

  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [syncBusy, setSyncBusy] = useState({});

  const narrow = useIsNarrow();

  const blankBASTs = bastC.data.filter(b => b.status === 'blank');

  // Item 3: order the full list — date desc, then sequence number desc.
  const sortedBASTs = useMemo(() => {
    return [...bastC.data].sort((a, b) => {
      const d = String(b.tanggalBast || '').localeCompare(String(a.tanggalBast || ''));
      if (d !== 0) return d;
      return bastSeq(b) - bastSeq(a);
    });
  }, [bastC.data]);

  const pg = usePagination(sortedBASTs, 20);

  const doById = useMemo(() => {
    const m = {};
    for (const d of doC.data) m[d.id] = d;
    return m;
  }, [doC.data]);

  // Discrepancy between a BAST and its DO (item 2 companion — for the sync action).
  const diffsForBAST = (b) => {
    const d = doById[b.deliveryOrderId];
    if (!d) return [];
    return diffDOtoBAST(d, b);
  };

  const startEdit = (b) => {
    const copy = JSON.parse(JSON.stringify(b));
    if (b.status === 'blank') copy.tanggalBast = todayISO();
    setForm(copy); setEditId(b.id);
  };
  const cancel = () => { setForm(null); setEditId(null); };
  const setNested = (path, v) => setForm(f => {
    const next = JSON.parse(JSON.stringify(f));
    const keys = path.split('.'); let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = v;
    return next;
  });

  const transitLoss = form
    ? (Number(form.dispatchedVolumeL) || 0) - (Number(form.qty.literStandard) || 0)
    : 0;

  // Pull the BAST's inherited fields back in line with its DO.
  // For blank BASTs this is silent-safe; for filled ones we confirm first.
  const syncFromDO = async (b) => {
    const d = doById[b.deliveryOrderId];
    if (!d) { alert('No linked DO found for this BAST.'); return; }
    const diffs = diffDOtoBAST(d, b);
    if (!diffs.length) { alert('This BAST already matches its DO.'); return; }

    let msg = `Update ${diffs.length} field(s) on BAST ${b.nomorBast} from DO ${d.brNo}?\n\n` +
      diffs.map(x => `• ${x.label}: ${x.bastVal ?? '—'} → ${x.doVal ?? '—'}`).join('\n');
    if (b.status !== 'blank') {
      msg += `\n\nNOTE: this BAST is already filled. Header fields will be updated; received volumes and transit loss are NOT touched.`;
    }
    if (!confirm(msg)) return;

    setSyncBusy(m => ({ ...m, [b.id]: true }));
    try {
      const cargoOwner = CARGO_OWNER[d.scheme] || ISSUERS[d.issuerKey]?.name || '';
      await bastC.update(b.id, {
        supplier:      { ...(b.supplier || {}), name: cargoOwner, deliveryOrder: d.brNo },
        recipient:     { ...(b.recipient || {}), entityName: d.deliverTo || '', vesselName: d.vesselName || '' },
        deliveredFrom: { ...(b.deliveredFrom || {}), facility: d.deliveredFrom || '', port: d.nodePort ?? b.deliveredFrom?.port ?? '' },
        dispatchedVolumeL: Number(d.dispatchedVolumeL) || 0,
        penyalur:      { ...(b.penyalur || {}), quantity: String(Number(d.dispatchedVolumeL) || 0) },
      });
    } catch (e) {
      alert('Error syncing BAST: ' + e.message);
    } finally {
      setSyncBusy(m => ({ ...m, [b.id]: false }));
    }
  };

  const save = async () => {
    if (busy) return;
    if (!form.qty.literStandard) { alert('Liter Standard (@15°C) is required.'); return; }
    setBusy(true);
    try {
      const d = new Date(form.tanggalBast);
      const payload = {
        deliveryOrderId: form.deliveryOrderId,
        nomorBast: form.nomorBast,
        tanggalBast: form.tanggalBast,
        tanggalBastText: `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        hari: INDO_DAYS[d.getDay()],
        supplier: form.supplier,
        penyalur: form.penyalur,
        recipient: form.recipient,
        deliveredFrom: form.deliveredFrom,
        qty: form.qty,
        uom: form.uom || 'Liter',
        note: form.note || '',
        transitLossL: transitLoss,
        dispatchedVolumeL: form.dispatchedVolumeL,
        signers: form.signers,
        status: 'bast_done',
      };
      await bastC.update(editId, payload);
      if (form.deliveryOrderId) {
        await doC.update(form.deliveryOrderId, { status: 'delivered' });
        const theDO = doC.data.find(x => x.id === form.deliveryOrderId);
        if (theDO?.salesRequestId) await srC.update(theDO.salesRequestId, { status: 'bast_done' });
      }
      cancel();
    } catch (e) {
      alert('Error saving BAST: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const printBAST = async (b) => {
    const d = new Date(b.tanggalBast);
    const hari = b.hari || INDO_DAYS[d.getDay()];
    const teks = b.tanggalBastText || `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    let qrDataUrl = '';
    try { qrDataUrl = await makeQR('bast', b.id); } catch (e) { /* QR optional */ }
    const html = buildBASTHtml({
      usiLogo: USI_LOGO,
      nomorBast: b.nomorBast,
      tanggalBast: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      hari,
      tanggalTeks: teks,
      supplier: b.supplier,
      penyalur: b.penyalur,
      recipient: b.recipient || { entityName: '', vesselName: '', receiverName: '' },
      deliveredFrom: b.deliveredFrom || { facility: '', port: '' },
      qty: b.qty,
      uom: b.uom || 'Liter',
      note: b.note || '',
      qrDataUrl,
      verifyCode: b.nomorBast,
      signers: b.signers,
    });
    openPrint(html);
  };

  const del = async (b) => {
    if (!confirm(`Delete BAST ${b.nomorBast}?`)) return;
    await bastC.remove(b.id);
  };

  const fmtL = n => (Number(n) || 0).toLocaleString('id-ID');
  const clientOf = b => b.recipient?.entityName || '—';
  const vesselOf = b => b.recipient?.vesselName || '—';

  return (
    <div style={{ padding: narrow ? 16 : 40, maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>BAST — BERITA ACARA SERAH TERIMA</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          Records received volume against a DO. Transit loss = dispatched − received. Always USI PTS as operator. 4-copy PDF.
        </div>
      </div>

      {/* Blank BASTs awaiting fill */}
      {!form && blankBASTs.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            BLANK BASTs — PRINT PRE-BUNKER, FILL AFTER LOADING
          </div>
          {blankBASTs.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: T.amber, fontFamily: T.font, fontSize: 11 }}>{b.nomorBast}</span>
                <span style={{ color: T.textDim }}> · DO {b.supplier?.deliveryOrder} · {clientOf(b)} · {vesselOf(b)} · {fmtL(b.dispatchedVolumeL)} L</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>
                  PRINT BLANK
                </button>
                <button onClick={() => startEdit(b)} style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 10 }}>
                  FILL →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 4 }}>
            FILL BAST {form.nomorBast || ''}
          </div>
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 14 }}>
            Against DO <span style={{ color: T.amber }}>{form.supplier.deliveryOrder}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={s.label}>BAST Date</label>
              <input style={s.input} type="date" value={form.tanggalBast} onChange={e => setNested('tanggalBast', e.target.value)} />
            </div>
          </div>

          {/* Supplier */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Supplier / Cargo Owner</label>
              <input style={s.input} value={form.supplier?.name || ''} onChange={e => setNested('supplier.name', e.target.value)} />
            </div>
          </div>

          {/* Penyalur */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.4fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Penyalur (Distributor)</label>
              <input style={s.input} value={form.penyalur?.name || ''} onChange={e => setNested('penyalur.name', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Transport Vessel</label>
              <input style={s.input} value={form.penyalur?.vesselName || ''} onChange={e => setNested('penyalur.vesselName', e.target.value)} placeholder="Norlha 6" />
            </div>
            <div>
              <label style={s.label}>Nakhoda</label>
              <input style={s.input} value={form.penyalur?.nakhoda || ''} onChange={e => setNested('penyalur.nakhoda', e.target.value)} />
            </div>
          </div>

          {/* Recipient + Delivered From */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.4fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Recipient / Client</label>
              <input style={s.input} value={form.recipient?.entityName || ''} onChange={e => setNested('recipient.entityName', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Receiving Vessel</label>
              <input style={s.input} value={form.recipient?.vesselName || ''} onChange={e => setNested('recipient.vesselName', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Receiver Name (Penerima)</label>
              <input style={s.input} value={form.recipient?.receiverName || ''} onChange={e => setNested('recipient.receiverName', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Delivered From (Facility)</label>
              <input style={s.input} value={form.deliveredFrom?.facility || ''} onChange={e => setNested('deliveredFrom.facility', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Port</label>
              <input style={s.input} value={form.deliveredFrom?.port || ''} onChange={e => setNested('deliveredFrom.port', e.target.value)} />
            </div>
          </div>

          {/* Quantity block */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>QUANTITY</div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div>
              <label style={s.label}>Volume Observed</label>
              <VolumeInput value={form.qty.volumeObserved}
                onChange={v => setNested('qty.volumeObserved', v)} placeholder="observed vol" />
            </div>
            <div>
              <label style={s.label}>Liter Standard @15°C (R)</label>
              <VolumeInput value={form.qty.literStandard}
                onChange={v => setNested('qty.literStandard', v)} placeholder="corrected vol" />
            </div>
            <div>
              <label style={s.label}>Dispatched (D)</label>
              <input style={{ ...s.input, opacity: .6 }} value={fmtL(form.dispatchedVolumeL)} disabled />
            </div>
            <div>
              <label style={s.label}>Transit Loss (D−R std)</label>
              <input style={{ ...s.input, opacity: .8, color: transitLoss > 0 ? T.red : T.text }}
                value={fmtL(transitLoss)} disabled />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div>
              <label style={s.label}>Suhu / Temp (°C)</label>
              <input style={s.input} value={form.qty.suhu} onChange={e => setNested('qty.suhu', e.target.value)} placeholder="32" />
            </div>
            <div>
              <label style={s.label}>Density</label>
              <input style={s.input} value={form.qty.density} onChange={e => setNested('qty.density', e.target.value)} placeholder="0.845" />
            </div>
            <div>
              <label style={s.label}>Water Content</label>
              <input style={s.input} value={form.qty.waterContent} onChange={e => setNested('qty.waterContent', e.target.value)} placeholder="0.05%" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Shore Tank</label>
              <input style={s.input} value={form.qty.shoreTank} onChange={e => setNested('qty.shoreTank', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Flow meter Awal</label>
              <input style={s.input} value={form.qty.fmAwal} onChange={e => setNested('qty.fmAwal', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Flow meter Akhir</label>
              <input style={s.input} value={form.qty.fmAkhir} onChange={e => setNested('qty.fmAkhir', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <label style={s.label}>Jam Start</label>
                <input style={s.input} value={form.qty.jamStart} onChange={e => setNested('qty.jamStart', e.target.value)} placeholder="17.00" />
              </div>
              <div>
                <label style={s.label}>Jam End</label>
                <input style={s.input} value={form.qty.jamEnd} onChange={e => setNested('qty.jamEnd', e.target.value)} placeholder="05.15" />
              </div>
            </div>
          </div>

          {/* UoM + Note */}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '160px 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Unit of Measurement</label>
              <input style={s.input} value={form.uom || ''} onChange={e => setNested('uom', e.target.value)} placeholder="Liter" />
            </div>
            <div>
              <label style={s.label}>Note / Catatan / Remarks (disputes, remarks)</label>
              <textarea style={{ ...s.input, minHeight: 110, resize: 'vertical', fontFamily: T.font, lineHeight: 1.5 }}
                rows={5}
                value={form.note || ''} onChange={e => setNested('note', e.target.value)}
                placeholder="Any remarks about the bunker activity — disputes, discrepancies, agreed adjustments…" />
            </div>
          </div>

          {/* Signers */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>SIGNERS</div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['diserahkan','Diserahkan Oleh'],['diterima','Diterima Oleh'],['diketahui','Diketahui Oleh']].map(([who,lbl]) => (
              <div key={who}>
                <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 4 }}>{lbl}</div>
                <input style={{ ...s.input, marginBottom: 4 }} value={form.signers[who].name}
                  onChange={e => setNested(`signers.${who}.name`, e.target.value)} placeholder="name" />
                <input style={s.input} value={form.signers[who].role}
                  onChange={e => setNested(`signers.${who}.role`, e.target.value)} placeholder="role" />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={busy} style={s.btn('primary')}>
              {busy ? 'SAVING…' : (editId ? 'SAVE' : 'CREATE BAST')}
            </button>
            <button onClick={cancel} style={s.btn('ghost')}>CANCEL</button>
          </div>
        </div>
      )}

      {/* List */}
      {bastC.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : bastC.data.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No BAST records yet.</div>
      ) : narrow ? (
        // -------- Mobile: stacked cards --------
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pg.pageRows.map(b => {
            const diffs = diffsForBAST(b);
            return (
              <div key={b.id} style={{ ...s.card, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: T.font, color: T.amber, fontSize: 11 }}>{b.nomorBast}</span>
                  <span style={{ fontSize: 10, color: b.status === 'blank' ? T.textDim : T.green }}>
                    {b.status === 'blank' ? 'blank (pre-bunker)' : 'completed'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: T.text }}>{clientOf(b)}</div>
                <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <span>{b.tanggalBast}</span>
                  <span>· {vesselOf(b)}</span>
                  <span style={{ fontFamily: T.font }}>· DO {b.supplier?.deliveryOrder || '—'}</span>
                </div>
                <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <span>Received: <span style={{ fontFamily: T.font, color: T.text }}>{b.status === 'blank' ? '—' : fmtL(b.qty?.literStandard)}</span></span>
                  <span style={{ color: b.transitLossL > 0 ? T.red : T.textDim }}>
                    · Loss: <span style={{ fontFamily: T.font }}>{b.status === 'blank' ? '—' : fmtL(b.transitLossL)}</span>
                  </span>
                </div>
                {diffs.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 10, color: T.amber }}>
                    ⚠ Differs from DO ({diffs.length} field{diffs.length > 1 ? 's' : ''})
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>PDF</button>
                  <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>
                    {b.status === 'blank' ? 'FILL' : 'EDIT'}
                  </button>
                  {diffs.length > 0 && (
                    <button onClick={() => syncFromDO(b)} disabled={syncBusy[b.id]}
                      style={{ ...s.btn('primary'), padding: '5px 12px', fontSize: 10 }}>
                      {syncBusy[b.id] ? 'SYNCING…' : 'SYNC FROM DO'}
                    </button>
                  )}
                  <button onClick={() => del(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10, color: T.red }}>DEL</button>
                </div>
              </div>
            );
          })}
          <PaginationBar {...pg} />
        </div>
      ) : (
        // -------- Desktop: table --------
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>BAST NUMBER</th>
                <th style={s.th}>DATE</th>
                <th style={s.th}>CLIENT</th>
                <th style={s.th}>VESSEL</th>
                <th style={s.th}>DO REF</th>
                <th style={s.th}>STATUS</th>
                <th style={{ ...s.th, textAlign: 'right' }}>RECEIVED (L)</th>
                <th style={{ ...s.th, textAlign: 'right' }}>TRANSIT LOSS</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageRows.map(b => {
                const diffs = diffsForBAST(b);
                return (
                  <tr key={b.id}>
                    <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>
                      {b.nomorBast}
                      {diffs.length > 0 && <span title={`Differs from DO (${diffs.length} field(s))`} style={{ color: T.amber, marginLeft: 6 }}>⚠</span>}
                    </td>
                    <td style={s.td}>{b.tanggalBast}</td>
                    <td style={s.td}>{clientOf(b)}</td>
                    <td style={s.td}>{vesselOf(b)}</td>
                    <td style={{ ...s.td, fontFamily: T.font, fontSize: 10 }}>{b.supplier?.deliveryOrder}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: 10, color: b.status === 'blank' ? T.textDim : T.green }}>
                        {b.status === 'blank' ? 'blank (pre-bunker)' : 'completed'}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>
                      {b.status === 'blank' ? '—' : fmtL(b.qty?.literStandard)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: b.transitLossL > 0 ? T.red : T.text }}>
                      {b.status === 'blank' ? '—' : fmtL(b.transitLossL)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>PDF</button>
                      <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>
                        {b.status === 'blank' ? 'FILL' : 'EDIT'}
                      </button>
                      {diffs.length > 0 && (
                        <button onClick={() => syncFromDO(b)} disabled={syncBusy[b.id]}
                          style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6, color: T.amber, borderColor: T.amber }}>
                          {syncBusy[b.id] ? 'SYNC…' : 'SYNC'}
                        </button>
                      )}
                      <button onClick={() => del(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                    </td>
                  </tr>
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
