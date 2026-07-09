import { useState } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS } from '../config';
import { useCollection } from './useCollection';
import { buildBASTHtml } from './bastGen';
import VolumeInput from './VolumeInput';
import { USI_LOGO } from './assets';
import { makeQR } from './qr';

const todayISO = () => new Date().toISOString().slice(0, 10);
const INDO_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const INDO_DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

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

  // BASTs are auto-created (blank) when a DO is issued. This module FILLS them.
  const blankBASTs = bastC.data.filter(b => b.status === 'blank');

  const startEdit = (b) => { setForm(JSON.parse(JSON.stringify(b))); setEditId(b.id); };
  const cancel = () => { setForm(null); setEditId(null); };
  const setNested = (path, v) => setForm(f => {
    const next = JSON.parse(JSON.stringify(f));
    const keys = path.split('.'); let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = v;
    return next;
  });

  const transitLoss = form
    ? (Number(form.dispatchedVolumeL) || 0) - (Number(form.qty.volumeDiterima) || 0)
    : 0;

  const save = async () => {
    if (busy) return;
    if (!form.qty.volumeDiterima) { alert('Volume Diterima (received) is required.'); return; }
    setBusy(true);
    try {
      const d = new Date(form.tanggalBast);
      // The BAST number already exists (allocated when the DO was issued). We only fill.
      const payload = {
        deliveryOrderId: form.deliveryOrderId,
        nomorBast: form.nomorBast,
        tanggalBast: form.tanggalBast,
        tanggalBastText: `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        hari: INDO_DAYS[d.getDay()],
        supplier: form.supplier,
        penyalur: form.penyalur,
        transportir: form.transportir,
        qty: form.qty,
        uom: form.uom || 'Liter',
        note: form.note || '',
        transitLossL: transitLoss,
        dispatchedVolumeL: form.dispatchedVolumeL,
        signers: form.signers,
        status: 'bast_done',
      };
      await bastC.update(editId, payload);
      // advance DO + its sales request now that received volume is recorded
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
      transportir: b.transportir,
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

  return (
    <div style={{ padding: 40, maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>BAST — BERITA ACARA SERAH TERIMA</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          Records received volume against a DO. Transit loss = dispatched − received. Always USI PTS as operator. 4-copy PDF.
        </div>
      </div>

      {/* Blank BASTs awaiting fill (auto-created with their DO; printable pre-bunker) */}
      {!form && blankBASTs.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            BLANK BASTs — PRINT PRE-BUNKER, FILL AFTER LOADING
          </div>
          {blankBASTs.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: T.amber, fontFamily: T.font, fontSize: 11 }}>{b.nomorBast}</span>
                <span style={{ color: T.textDim }}> · DO {b.supplier?.deliveryOrder} · {fmtL(b.dispatchedVolumeL)} L dispatched</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={s.label}>BAST Date</label>
              <input style={s.input} type="date" value={form.tanggalBast} onChange={e => setNested('tanggalBast', e.target.value)} />
            </div>
          </div>

          {/* Penyalur / Transportir vessels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Penyalur Vessel</label>
              <input style={s.input} value={form.penyalur.vesselName} onChange={e => setNested('penyalur.vesselName', e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Transportir Vessel</label>
              <input style={s.input} value={form.transportir.vesselName} onChange={e => setNested('transportir.vesselName', e.target.value)} placeholder="Norlha 6" />
            </div>
            <div>
              <label style={s.label}>Nakhoda</label>
              <input style={s.input} value={form.transportir.nakhoda} onChange={e => setNested('transportir.nakhoda', e.target.value)} />
            </div>
          </div>

          {/* Quantity block */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>QUANTITY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div>
              <label style={s.label}>Volume Diterima (R)</label>
              <VolumeInput value={form.qty.volumeDiterima}
                onChange={v => setNested('qty.volumeDiterima', v)} placeholder="398.400" />
            </div>
            <div>
              <label style={s.label}>Dispatched (D)</label>
              <input style={{ ...s.input, opacity: .6 }} value={fmtL(form.dispatchedVolumeL)} disabled />
            </div>
            <div>
              <label style={s.label}>Transit Loss (D−R)</label>
              <input style={{ ...s.input, opacity: .8, color: transitLoss > 0 ? T.red : T.text }}
                value={fmtL(transitLoss)} disabled />
            </div>
            <div>
              <label style={s.label}>Suhu</label>
              <input style={s.input} value={form.qty.suhu} onChange={e => setNested('qty.suhu', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={s.label}>Unit of Measurement</label>
              <input style={s.input} value={form.uom || ''} onChange={e => setNested('uom', e.target.value)} placeholder="Liter" />
            </div>
            <div>
              <label style={s.label}>Note / Catatan (disputes, remarks)</label>
              <textarea style={{ ...s.input, minHeight: 52, resize: 'vertical', fontFamily: T.font }}
                value={form.note || ''} onChange={e => setNested('note', e.target.value)}
                placeholder="Any remarks about the bunker activity…" />
            </div>
          </div>

          {/* Signers */}
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>SIGNERS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
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
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={s.th}>BAST NUMBER</th>
              <th style={s.th}>DATE</th>
              <th style={s.th}>DO REF</th>
              <th style={s.th}>STATUS</th>
              <th style={{ ...s.th, textAlign: 'right' }}>RECEIVED (L)</th>
              <th style={{ ...s.th, textAlign: 'right' }}>TRANSIT LOSS</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {bastC.data.map(b => (
              <tr key={b.id}>
                <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>{b.nomorBast}</td>
                <td style={s.td}>{b.tanggalBast}</td>
                <td style={{ ...s.td, fontFamily: T.font, fontSize: 10 }}>{b.supplier?.deliveryOrder}</td>
                <td style={s.td}>
                  <span style={{ fontSize: 10, color: b.status === 'blank' ? T.textDim : T.green }}>
                    {b.status === 'blank' ? 'blank (pre-bunker)' : 'completed'}
                  </span>
                </td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>
                  {b.status === 'blank' ? '—' : fmtL(b.qty?.volumeDiterima)}
                </td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: b.transitLossL > 0 ? T.red : T.text }}>
                  {b.status === 'blank' ? '—' : fmtL(b.transitLossL)}
                </td>
                <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>PDF</button>
                  <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>
                    {b.status === 'blank' ? 'FILL' : 'EDIT'}
                  </button>
                  <button onClick={() => del(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
