import { useState } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS, formatBastNumber, ROMAN } from '../config';
import { useCollection } from './useCollection';
import { allocateNumber } from './counters';
import { buildBASTHtml } from './bastGen';
import { USI_LOGO } from './assets';

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

  // DOs issued but without a BAST yet
  const bastByDo = new Set(bastC.data.map(b => b.deliveryOrderId));
  const openDOs = doC.data.filter(d => d.status === 'issued' && !bastByDo.has(d.id));

  const startFromDO = (d) => {
    // supplier/penyalur = the DO issuer entity; transportir = USI PTS (operator)
    const issuerName = ISSUERS[d.issuerKey]?.name || '';
    setForm({
      deliveryOrderId: d.id,
      tanggalBast: todayISO(),
      supplier:    { name: issuerName, deliveryOrder: d.brNo },
      penyalur:    { name: issuerName, vesselName: '', doPoSpk: d.brNo, quantity: String(d.dispatchedVolumeL) },
      transportir: { name: ISSUERS.USI_PTS.name, vesselName: '', nakhoda: '' },
      qty: { volumeDiterima: '', shoreTank: '', fmAwal: '', fmAkhir: '', suhu: '', jamStart: '', jamEnd: '' },
      signers: {
        diserahkan: { name: '', role: 'Master / Chef Officer' },
        diterima:   { name: '', role: '' },
        diketahui:  { name: '', role: 'SpV USIPTS' },
      },
      dispatchedVolumeL: d.dispatchedVolumeL,
    });
    setEditId(null);
  };

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
      let nomorBast = form.nomorBast;
      const d = new Date(form.tanggalBast);
      if (!editId) {
        const year = d.getFullYear();
        const seq = await allocateNumber('bast', year);
        nomorBast = formatBastNumber({ seq, monthIndex: d.getMonth(), year });
      }
      const payload = {
        deliveryOrderId: form.deliveryOrderId,
        nomorBast,
        tanggalBast: form.tanggalBast,
        tanggalBastText: `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        hari: INDO_DAYS[d.getDay()],
        supplier: form.supplier,
        penyalur: form.penyalur,
        transportir: form.transportir,
        qty: form.qty,
        transitLossL: transitLoss,
        dispatchedVolumeL: form.dispatchedVolumeL,
        signers: form.signers,
        status: 'bast_done',
      };
      if (editId) {
        await bastC.update(editId, payload);
      } else {
        await bastC.add(payload);
        // advance DO + its sales request
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

  const printBAST = (b) => {
    const d = new Date(b.tanggalBast);
    const html = buildBASTHtml({
      usiLogo: USI_LOGO,
      nomorBast: b.nomorBast,
      tanggalBast: new Date(b.tanggalBast).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      hari: b.hari,
      tanggalTeks: b.tanggalBastText,
      supplier: b.supplier,
      penyalur: b.penyalur,
      transportir: b.transportir,
      qty: b.qty,
      signers: b.signers,
    });
    openPrint(html);
  };

  const del = async (b) => {
    if (!confirm(`Delete BAST ${b.nomorBast}? The DO reverts to 'issued'.`)) return;
    await bastC.remove(b.id);
    if (b.deliveryOrderId) await doC.update(b.deliveryOrderId, { status: 'issued' });
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

      {/* Open DOs */}
      {!form && openDOs.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            ISSUED DOs — CREATE A BAST
          </div>
          {openDOs.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: T.amber, fontFamily: T.font, fontSize: 11 }}>{d.brNo}</span>
                <span style={{ color: T.textDim }}> · {d.deliverTo} · {d.vesselName} · {fmtL(d.dispatchedVolumeL)} L</span>
              </div>
              <button onClick={() => startFromDO(d)} style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 10 }}>
                CREATE BAST →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {form && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1, marginBottom: 4 }}>
            {editId ? `EDIT BAST ${form.nomorBast || ''}` : 'NEW BAST'}
          </div>
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 14 }}>
            Against DO <span style={{ color: T.amber }}>{form.supplier.deliveryOrder}</span>
            {!editId && ' · BAST number allocated on save'}
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
              <input style={s.input} type="number" value={form.qty.volumeDiterima}
                onChange={e => setNested('qty.volumeDiterima', e.target.value)} placeholder="398400" />
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
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(b.qty?.volumeDiterima)}</td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: b.transitLossL > 0 ? T.red : T.text }}>
                  {fmtL(b.transitLossL)}
                </td>
                <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>PDF</button>
                  <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>EDIT</button>
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
