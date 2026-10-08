import { useState, useEffect, useMemo, useRef } from 'react';
import { T, s } from '../tokens';
import { COL, BUCKETS, TOLERANCE_PCT, ISSUERS, NODES, ROMAN, formatSppNumber } from '../config';
import { useCollection } from './useCollection';
import { canManage } from '../roles';
import { allocateNumber } from './counters';
import { useFuelOpsMaster } from './useFuelOpsMaster';
import VolumeInput from './VolumeInput';
import { buildCargoDOHtml } from './cargoDoGen';
import { PPS_LOGO } from './assets';
import { scanIncomingReport, SCAN_ACCEPT } from './scanIncoming';

// Open an HTML string in a new window and trigger print (matches DO/BAST flow).
function openPrint(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// Indonesian month labels for periodLabel ('Juli 2026').
const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli',
  'Agustus','September','Oktober','November','Desember'];

const todayISO = () => new Date().toISOString().slice(0, 10);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtL   = (n) => (Number(n) || 0).toLocaleString('id-ID');
const fmtRp  = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
const uid    = () => (crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));

// Deterministic card id: {nodeId}_{bucket}_{YYYY-MM}
const cardIdFor = (nodeId, bucket, year, month) =>
  `${nodeId}_${bucket}_${year}-${pad2(month)}`;

// Previous calendar month (as {year, month}), month is 1-12.
const prevPeriod = (year, month) =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

// All computed figures for a card. Full precision; round only at display.
// Observed received liters for an incoming row: the Actual-Received point's
// observed figure, falling back to the legacy flat volumeL for old records.
const rowReceivedObs = (r) =>
  Number(r?.load?.actual?.obs ?? r?.volumeL) || 0;

// Ensure a row has the 4-point `load` structure. Legacy rows (flat volumeL,
// no load) get an empty structure with their old volume mapped onto actual.obs.
const emptyPoint = () => ({ obs: '', l15: '', density: '', temp: '' });
function normalizeIncoming(r) {
  if (r.load && r.load.bl && r.load.actual) return r;
  return {
    ...r,
    load: {
      bl:     emptyPoint(),
      sfal:   emptyPoint(),
      sfbd:   emptyPoint(),
      actual: { ...emptyPoint(), obs: r.volumeL ?? '' },
    },
  };
}

function computeCard({ openingROB, incoming, dispatched, measuredROB }) {
  const totalC = (incoming || []).reduce((a, r) => a + rowReceivedObs(r), 0);
  const totalD = (dispatched || []).reduce((a, r) => a + (Number(r.dispatchedL) || 0), 0);
  const bookROB = (Number(openingROB) || 0) + totalC - totalD;
  const hasMeasured = measuredROB != null && measuredROB !== '';
  const storageLoss = hasMeasured ? bookROB - Number(measuredROB) : null;
  const toleranceAllowance = (TOLERANCE_PCT / 100) * totalC; // 0.3% -> 0.003 * ΣC
  const excessLoss = storageLoss == null ? null : Math.max(0, storageLoss - toleranceAllowance);
  return { totalC, totalD, bookROB, storageLoss, toleranceAllowance, excessLoss };
}

export default function StockCards({ role, user }) {
  const cardsC = useCollection(COL.stockCards);
  const nodesC = useCollection(COL.nodes);
  const doC    = useCollection(COL.deliveryOrders);
  const { fuelTypes, error: ftError } = useFuelOpsMaster();

  const now = new Date();
  const [sel, setSel] = useState({
    nodeId: '',
    bucket: BUCKETS[0],
    year:   now.getFullYear(),
    month:  now.getMonth() + 1,
  });

  // Local editable draft for the currently-selected card. Mirrors the stored
  // doc but holds unsaved edits until the user saves.
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy]   = useState(false);

  // Default node to the first available once nodes load.
  useEffect(() => {
    if (!sel.nodeId && nodesC.data.length) {
      setSel(v => ({ ...v, nodeId: nodesC.data[0].id }));
    }
  }, [nodesC.data, sel.nodeId]);

  const cardId = sel.nodeId ? cardIdFor(sel.nodeId, sel.bucket, sel.year, sel.month) : '';
  const stored = cardsC.data.find(c => c.id === cardId) || null;

  // Prior-month card (for openingROB carry-forward on a brand-new card).
  const prior = useMemo(() => {
    if (!sel.nodeId) return null;
    const p = prevPeriod(sel.year, sel.month);
    const pid = cardIdFor(sel.nodeId, sel.bucket, p.year, p.month);
    return cardsC.data.find(c => c.id === pid) || null;
  }, [cardsC.data, sel.nodeId, sel.bucket, sel.year, sel.month]);

  // (Re)build the draft whenever the selection resolves to a different card,
  // or the stored doc first arrives. Unsaved edits are dropped on selection change.
  useEffect(() => {
    if (!sel.nodeId) { setDraft(null); return; }
    const node = nodesC.data.find(n => n.id === sel.nodeId);
    if (stored) {
      setDraft({
        openingROB:       stored.openingROB ?? 0,
        incoming:         (stored.incoming ? JSON.parse(JSON.stringify(stored.incoming)) : [])
                            .map(r => normalizeIncoming(r)),
        dispatched:       stored.dispatched ? JSON.parse(JSON.stringify(stored.dispatched)) : [],
        measuredROB:      stored.measuredROB ?? '',
        compensationValue: stored.compensationValue ?? '',
        compensationNote:  stored.compensationNote ?? '',
        status:           stored.status || 'open',
      });
    } else {
      // Brand-new card: carry openingROB from the prior month's measured ROB.
      setDraft({
        openingROB:       prior?.measuredROB ?? 0,
        incoming:         [],
        dispatched:       [],
        measuredROB:      '',
        compensationValue: '',
        compensationNote:  '',
        status:           'open',
      });
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, stored?.id, !!stored, prior?.id]);

  const node    = nodesC.data.find(n => n.id === sel.nodeId);
  const locked  = draft?.status === 'locked';
  const editable = canManage(role, 'stockCards') && !locked;
  const computed = draft ? computeCard(draft) : null;

  const setSelField = (k, v) => setSel(s2 => ({ ...s2, [k]: v }));
  const patch = (obj) => { setDraft(d => ({ ...d, ...obj })); setDirty(true); };

  // ---- Incoming (manual) ---------------------------------------------------
  // TODO: later this links to a FuelOps incoming-cargo feed. Manual entry for now.
  // Each incoming cargo now carries 4 loading points (surveyor figures):
  //   bl    — B/L (shore / loading figure)
  //   sfal  — Ship Figure After Loading (R1)
  //   sfbd  — Ship Figure Before Discharging (R2)
  //   actual— Actual Received (final figure at destination)
  // Each point holds observed liters (mandatory), liter@15°C, density, temp.
  // R4 = Actual Received − B/L is computed, not stored.
  const blankPoint = () => ({ obs: '', l15: '', density: '', temp: '' });
  const addIncoming = () => patch({
    incoming: [...draft.incoming, {
      id: uid(), date: todayISO(), cargoRef: '', notes: '',
      load: { bl: blankPoint(), sfal: blankPoint(), sfbd: blankPoint(), actual: blankPoint() },
      // Mirror of actual.obs — keeps ΣC / permit quantity working for legacy readers.
      volumeL: '',
      // Optional permit-DO fields (for the port-authority bunker permit printout).
      permit: null,
    }],
  });
  const setIncoming = (id, field, v) => patch({
    incoming: draft.incoming.map(r => r.id === id ? { ...r, [field]: v } : r),
  });
  // Set one figure of one loading point; keep volumeL mirrored to actual.obs.
  const setLoadPoint = (id, point, field, v) => patch({
    incoming: draft.incoming.map(r => {
      if (r.id !== id) return r;
      const load = { ...(r.load || {}), [point]: { ...(r.load?.[point] || {}), [field]: v } };
      const next = { ...r, load };
      if (point === 'actual' && field === 'obs') next.volumeL = v;  // keep ΣC in sync
      return next;
    }),
  });
  const delIncoming = (id) => patch({ incoming: draft.incoming.filter(r => r.id !== id) });

  // R4 difference (Actual Received − B/L) for a row, per observed & @15°C.
  const r4Of = (r) => {
    const a = r.load?.actual || {}, b = r.load?.bl || {};
    const diff = (x, y) => (x === '' || x == null || y === '' || y == null)
      ? null : (Number(x) || 0) - (Number(y) || 0);
    return { obs: diff(a.obs, b.obs), l15: diff(a.l15, b.l15) };
  };

  // ---- Scan report → autofill a new incoming cargo row ----------------------
  // Reads a scanned surveyor report (jpg/png/pdf) with Gemini and fills the 4
  // loading points of a NEW cargo row as an editable draft. The scan is sent to
  // Gemini and discarded — never stored. User reviews/corrects, then SAVEs.
  const scanInputRef = useRef(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg]   = useState('');

  const onScanFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                 // allow re-selecting the same file later
    if (!file) return;
    setScanMsg(''); setScanBusy(true);
    try {
      const data = await scanIncomingReport(file);
      const nonEmpty = (p) => p && (p.obs !== '' || p.l15 !== '' || p.density !== '' || p.temp !== '');
      const found = ['bl', 'sfal', 'sfbd', 'actual'].filter(k => nonEmpty(data[k]));
      if (found.length === 0) {
        setScanMsg('Could not read any figures from that scan. Add the row manually, or try a clearer image.');
        return;
      }
      // Create a new row seeded with the extracted figures (editable).
      const row = {
        id: uid(), date: todayISO(), cargoRef: '', notes: '',
        load: {
          bl:     { ...blankPoint(), ...data.bl },
          sfal:   { ...blankPoint(), ...data.sfal },
          sfbd:   { ...blankPoint(), ...data.sfbd },
          actual: { ...blankPoint(), ...data.actual },
        },
        volumeL: data.actual?.obs ?? '',
        permit: null,
        _fromScan: true,
      };
      patch({ incoming: [...draft.incoming, row] });
      setScanMsg(`Scan read — filled ${found.length} of 4 loading point(s). Review the figures and SAVE.`);
    } catch (err) {
      setScanMsg(err.message || 'Scan failed.');
    } finally {
      setScanBusy(false);
    }
  };

  // ---- Permit DO / SPP (incoming-cargo → port-authority bunker permit) ------
  // Which incoming row currently has its permit editor open (id or null).
  const [permitOpen, setPermitOpen] = useState(null);
  const [permitBusy, setPermitBusy] = useState({}); // per-row spinner during SPP allocation

  // Seed a permit object from the row when first opened. portDestination
  // defaults to the selected node's name; quantity to the row's incoming volume.
  const openPermit = (r) => {
    if (!r.permit) {
      setIncoming(r.id, 'permit', {
        sppNo: '',                 // auto-allocated on first print
        referenceNo: '',           // user-typed PO / cargo ref
        estDeliveryDate: r.date || todayISO(),
        quantityL: r.volumeL || '',
        fuelTypeId: '',
        product: '',               // fuel type name (from dropdown / manual)
        portLoading: '',
        portDestination: node?.name || '',
        supplyVessel: '',
        recipientName: '',
        note: '',
      });
    }
    setPermitOpen(permitOpen === r.id ? null : r.id);
  };

  const setPermitField = (rowId, field, v) => {
    setDraft(d => ({
      ...d,
      incoming: d.incoming.map(r =>
        r.id === rowId ? { ...r, permit: { ...(r.permit || {}), [field]: v } } : r),
    }));
    setDirty(true);
  };

  // Selecting a fuel type stores both the id and its display name (product).
  const setPermitFuel = (rowId, fuelId) => {
    const ft = fuelTypes.find(f => f.id === fuelId);
    setDraft(d => ({
      ...d,
      incoming: d.incoming.map(r =>
        r.id === rowId
          ? { ...r, permit: { ...(r.permit || {}), fuelTypeId: fuelId, product: ft?.name || '' } }
          : r),
    }));
    setDirty(true);
  };

  const printPermit = async (r) => {
    if (permitBusy[r.id]) return;
    let p = r.permit || {};

    // Allocate the SPP number once, on first print, then reuse it forever.
    let sppNo = p.sppNo;
    if (!sppNo) {
      setPermitBusy(m => ({ ...m, [r.id]: true }));
      try {
        const d = new Date(p.estDeliveryDate || r.date || todayISO());
        const seq = await allocateNumber('spp', d.getFullYear());
        const issuerCode = ISSUERS.PPS.code; // issued under PPS (cargo owner)
        const nodeCode = node?.code || NODES.OB_GALLEY.code;
        sppNo = formatSppNumber({ seq, issuerCode, nodeCode, monthIndex: d.getMonth(), year: d.getFullYear() });
        // Persist onto the permit so reprints keep the same number.
        setPermitField(r.id, 'sppNo', sppNo);
        p = { ...p, sppNo };
      } catch (e) {
        setPermitBusy(m => ({ ...m, [r.id]: false }));
        alert('Could not allocate SPP number: ' + e.message);
        return;
      }
      setPermitBusy(m => ({ ...m, [r.id]: false }));
    }

    const html = buildCargoDOHtml({
      issuerLogo: PPS_LOGO,
      sppNo,
      printDate: todayISO(),
      estDeliveryDate: p.estDeliveryDate || r.date || '',
      quantityL: p.quantityL || r.volumeL || 0,
      product: p.product || '',
      portLoading: p.portLoading || '',
      portDestination: p.portDestination || node?.name || '',
      supplyVessel: p.supplyVessel || '',
      referenceNo: p.referenceNo || '',
      recipientName: p.recipientName || '',
      note: p.note || '',
    });
    openPrint(html);
  };

  // ---- Dispatched (pulled from Delivery Orders) ----------------------------
  const syncDispatched = () => {
    const matches = doC.data.filter(d =>
      d.nodeId === sel.nodeId &&
      d.bucket === sel.bucket &&
      d.brDate &&
      new Date(d.brDate).getFullYear() === Number(sel.year) &&
      new Date(d.brDate).getMonth() + 1 === Number(sel.month));
    // Merge: keep existing rows' notes matched by deliveryOrderId; refresh figures.
    const byDo = Object.fromEntries((draft.dispatched || []).map(r => [r.deliveryOrderId, r]));
    const next = matches.map(d => ({
      id: byDo[d.id]?.id || uid(),
      deliveryOrderId: d.id,
      doNumber: d.brNo || '',
      date: d.brDate || '',
      dispatchedL: Number(d.dispatchedVolumeL) || 0,
      notes: byDo[d.id]?.notes || '',
    }));
    patch({ dispatched: next });
  };

  // ---- Persist -------------------------------------------------------------
  const buildPayload = (extra = {}) => ({
    id: cardId,
    nodeId: sel.nodeId,
    nodeName: node?.name || '',
    bucket: sel.bucket,
    periodYear: Number(sel.year),
    periodMonth: Number(sel.month),
    periodLabel: `${MONTHS_ID[sel.month - 1]} ${sel.year}`,
    openingROB: Number(draft.openingROB) || 0,
    incoming: draft.incoming.map(r => {
      // Normalize each loading point's figures to numbers (blank → null).
      const pt = (p) => {
        const src = r.load?.[p] || {};
        const num = (x) => (x === '' || x == null) ? null : (Number(x) || 0);
        return { obs: num(src.obs), l15: num(src.l15), density: num(src.density), temp: num(src.temp) };
      };
      const load = { bl: pt('bl'), sfal: pt('sfal'), sfbd: pt('sfbd'), actual: pt('actual') };
      return {
        id: r.id, date: r.date, cargoRef: r.cargoRef, notes: r.notes,
        load,
        // volumeL mirrors the actual-received observed figure (the ΣC input).
        volumeL: load.actual.obs ?? (Number(r.volumeL) || 0),
        // Persist permit-DO fields when present, so the document can be reprinted.
        // (useCollection strips undefined; null is fine for "never set".)
        permit: r.permit || null,
      };
    }),
    dispatched: draft.dispatched,
    measuredROB: (draft.measuredROB === '' || draft.measuredROB == null) ? null : Number(draft.measuredROB),
    compensationValue: (draft.compensationValue === '' || draft.compensationValue == null) ? null : Number(draft.compensationValue),
    compensationNote: draft.compensationNote || '',
    status: draft.status || 'open',
    ...extra,
  });

  const persist = async (extra = {}) => {
    if (busy || !draft) return;
    setBusy(true);
    try {
      if (stored) {
        await cardsC.update(cardId, buildPayload(extra));
      } else {
        // First write for this deterministic id — use setWithId, not add().
        await cardsC.setWithId(cardId, { ...buildPayload(extra), createdBy: user?.email || '' });
      }
      setDirty(false);
    } catch (e) {
      alert('Error saving stock card: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const save  = () => persist();
  const close = async () => {
    if (draft.measuredROB === '' || draft.measuredROB == null) {
      alert('Set the measured ROB (month-end sounding) before closing.');
      return;
    }
    if (!confirm('Close this stock card? It records who closed it and when.')) return;
    setDraft(d => ({ ...d, status: 'closed' }));
    await persist({ status: 'closed', closedBy: user?.email || '', closedAt: new Date().toISOString() });
  };
  const reopen = async () => {
    if (!confirm('Re-open this closed card for edits?')) return;
    setDraft(d => ({ ...d, status: 'open' }));
    await persist({ status: 'open' });
  };
  const lock = async () => {
    if (!confirm('Lock this card? It becomes permanently immutable in the UI.')) return;
    setDraft(d => ({ ...d, status: 'locked' }));
    await persist({ status: 'locked' });
  };

  // One loading point's editor: observed (mandatory) + L15 + density + temp.
  const loadPointEditor = (r, key, label, note) => {
    const p = r.load?.[key] || {};
    return (
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, padding: 10 }}>
        <div style={{ fontSize: 10, color: T.amber, letterSpacing: 1, marginBottom: 2 }}>{label}</div>
        {note && <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 6 }}>{note}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <label style={{ ...s.label, fontSize: 9 }}>Observed (L) *</label>
            {editable
              ? <VolumeInput value={p.obs} onChange={v => setLoadPoint(r.id, key, 'obs', v)} placeholder="obs" />
              : <div style={{ fontFamily: T.font, fontSize: 12 }}>{fmtL(p.obs)}</div>}
          </div>
          <div>
            <label style={{ ...s.label, fontSize: 9 }}>Liter @15°C</label>
            {editable
              ? <VolumeInput value={p.l15} onChange={v => setLoadPoint(r.id, key, 'l15', v)} placeholder="L15" />
              : <div style={{ fontFamily: T.font, fontSize: 12 }}>{p.l15 == null || p.l15 === '' ? '—' : fmtL(p.l15)}</div>}
          </div>
          <div>
            <label style={{ ...s.label, fontSize: 9 }}>Density</label>
            {editable
              ? <input style={{ ...s.input, fontSize: 11 }} value={p.density ?? ''} onChange={e => setLoadPoint(r.id, key, 'density', e.target.value)} placeholder="0.8540" />
              : <div style={{ fontFamily: T.font, fontSize: 12 }}>{p.density == null || p.density === '' ? '—' : p.density}</div>}
          </div>
          <div>
            <label style={{ ...s.label, fontSize: 9 }}>Temp (°C)</label>
            {editable
              ? <input style={{ ...s.input, fontSize: 11 }} value={p.temp ?? ''} onChange={e => setLoadPoint(r.id, key, 'temp', e.target.value)} placeholder="28" />
              : <div style={{ fontFamily: T.font, fontSize: 12 }}>{p.temp == null || p.temp === '' ? '—' : p.temp}</div>}
          </div>
        </div>
      </div>
    );
  };

  // The SPP / permit-DO editor panel for one incoming row (shown when open).
  const permitEditor = (r) => (
    <div style={{ background: T.amberGlow, padding: 14, borderTop: `2px solid ${T.amber}`, borderRadius: 4, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: T.amber, letterSpacing: 1.5 }}>
          SPP — SURAT PENGANTAR PENGIRIMAN · for port-authority bunker permit
          {r.permit?.sppNo && (
            <span style={{ color: T.text, fontFamily: T.font, marginLeft: 8 }}>{r.permit.sppNo}</span>
          )}
        </div>
        <button onClick={() => setPermitOpen(null)}
          style={{ ...s.btn('ghost'), padding: '2px 10px', fontSize: 10 }}>CLOSE</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Est. Delivery Date">
          <input style={s.input} type="date" value={r.permit?.estDeliveryDate || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'estDeliveryDate', e.target.value)} />
        </Field>
        <Field label="Cargo Item / Fuel Type">
          {ftError ? (
            <input style={s.input} value={r.permit?.product || ''} disabled={!editable}
              onChange={e => setPermitField(r.id, 'product', e.target.value)}
              placeholder="type fuel (FuelOps unavailable)" />
          ) : (
            <select style={s.input} value={r.permit?.fuelTypeId || ''} disabled={!editable}
              onChange={e => setPermitFuel(r.id, e.target.value)}>
              <option value="">— select fuel —</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Quantity (L)">
          <VolumeInput value={r.permit?.quantityL ?? ''} disabled={!editable}
            onChange={v => setPermitField(r.id, 'quantityL', v)} placeholder="200.000" />
        </Field>
        <Field label="Port Loading">
          <input style={s.input} value={r.permit?.portLoading || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'portLoading', e.target.value)}
            placeholder="load port" />
        </Field>
        <Field label="Port Destination">
          <select style={s.input} value={r.permit?.portDestination || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'portDestination', e.target.value)}>
            <option value="">— select node —</option>
            {nodesC.data.map(n => <option key={n.id} value={n.name}>{n.name}</option>)}
          </select>
        </Field>
        <Field label="Supply Vessel">
          <input style={s.input} value={r.permit?.supplyVessel || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'supplyVessel', e.target.value)}
            placeholder="e.g. SPOB Berkat Anugerah 06" />
        </Field>
        <Field label="Reference Number (PO / cargo ref)">
          <input style={s.input} value={r.permit?.referenceNo || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'referenceNo', e.target.value)}
            placeholder="PO number" />
        </Field>
        <Field label="Recipient Name">
          <input style={s.input} value={r.permit?.recipientName || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'recipientName', e.target.value)}
            placeholder="signer name" />
        </Field>
        <Field label="Note (optional)">
          <input style={s.input} value={r.permit?.note || ''} disabled={!editable}
            onChange={e => setPermitField(r.id, 'note', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button onClick={() => printPermit(r)} disabled={permitBusy[r.id]}
          style={{ ...s.btn('primary'), padding: '6px 16px', fontSize: 10 }}>
          {permitBusy[r.id] ? 'ALLOCATING SPP…' : (r.permit?.sppNo ? 'REPRINT SPP' : 'PRINT SPP')}
        </button>
        <span style={{ fontSize: 9, color: T.textFaint }}>
          Issued under PPS. {r.permit?.sppNo
            ? 'SPP number already assigned — reprints keep it.'
            : 'SPP number is allocated on first print.'}
          {!editable && ' View-only — reprints existing values.'}
        </span>
      </div>
    </div>
  );

  // App only routes here for roles with >= view access, so no extra gate here.
  return (
    <div style={{ padding: 40, maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>STOCK CARDS</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          One card per node · bucket · month. Buckets (PPS / MBSS) are never commingled.
          Dispatched pulls from Delivery Orders; incoming cargo is entered manually.
        </div>
      </div>

      {/* Selector row */}
      <div style={{ ...s.card, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={s.label}>Node</label>
            <select style={s.input} value={sel.nodeId} onChange={e => setSelField('nodeId', e.target.value)}>
              {nodesC.data.length === 0 && <option value="">No nodes</option>}
              {nodesC.data.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Bucket</label>
            <select style={s.input} value={sel.bucket} onChange={e => setSelField('bucket', e.target.value)}>
              {BUCKETS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Year</label>
            <input style={s.input} type="number" value={sel.year}
              onChange={e => setSelField('year', Number(e.target.value))} />
          </div>
          <div>
            <label style={s.label}>Month</label>
            <select style={s.input} value={sel.month} onChange={e => setSelField('month', Number(e.target.value))}>
              {MONTHS_ID.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.textDim, marginTop: 12 }}>
          Card: <span style={{ color: T.amber, fontFamily: T.font }}>{cardId || '—'}</span>
          {' · '}Status: <span style={{
            color: locked ? T.red : draft?.status === 'closed' ? T.blue : T.green,
          }}>{draft?.status || '—'}</span>
          {!stored && draft && <span style={{ color: T.textFaint }}> · new (unsaved)</span>}
          {dirty && <span style={{ color: T.amber }}> · unsaved changes</span>}
        </div>
      </div>

      {!draft ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>Select a node to load a card.</div>
      ) : (
        <>
          {/* Summary panel */}
          <div style={{ ...s.card, marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 14 }}>SUMMARY</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Field label="Opening ROB (L)">
                <VolumeInput value={draft.openingROB}
                  onChange={v => patch({ openingROB: v })}
                  disabled={!editable} />
                <Hint>{prior ? 'Carried from prior month measured ROB (editable).' : 'First card — set manually.'}</Hint>
              </Field>
              <Metric label="ΣC — Incoming (L)" value={fmtL(computed.totalC)} />
              <Metric label="ΣD — Dispatched (L)" value={fmtL(computed.totalD)} />

              <Metric label="Book ROB (L)" value={fmtL(computed.bookROB)}
                hint="openingROB + ΣC − ΣD" strong />
              <Field label="Measured ROB (L)">
                <VolumeInput value={draft.measuredROB}
                  onChange={v => patch({ measuredROB: v })}
                  disabled={!editable} placeholder="month-end sounding" />
              </Field>
              <Metric label="Storage Loss (L)"
                value={computed.storageLoss == null ? '—' : fmtL(computed.storageLoss)}
                hint="bookROB − measuredROB"
                color={computed.storageLoss != null && computed.storageLoss > computed.toleranceAllowance ? T.red : undefined} />

              <Metric label={`Tolerance (${TOLERANCE_PCT}% × ΣC) (L)`} value={fmtL(computed.toleranceAllowance)} />
              <Metric label="Excess Loss (L)"
                value={computed.excessLoss == null ? '—' : fmtL(computed.excessLoss)}
                hint="max(0, storageLoss − tolerance)"
                color={computed.excessLoss ? T.red : undefined} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginTop: 16,
              paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
              <Field label="Compensation Value (IDR)">
                <VolumeInput value={draft.compensationValue}
                  onChange={v => patch({ compensationValue: v })}
                  disabled={!editable} placeholder="manual — deferred pricing" />
                <Hint>Manual only. USI PTS compensates excess loss; not auto-calculated.</Hint>
              </Field>
              <Field label="Compensation Note">
                <input style={s.input} value={draft.compensationNote}
                  disabled={!editable}
                  onChange={e => patch({ compensationNote: e.target.value })} />
              </Field>
            </div>
          </div>

          {/* Incoming section */}
          <div style={{ ...s.card, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5 }}>
                INCOMING CARGO (C) — {sel.bucket} · manual
              </div>
              {editable && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input ref={scanInputRef} type="file" accept={SCAN_ACCEPT}
                    style={{ display: 'none' }} onChange={onScanFile} />
                  <button onClick={() => scanInputRef.current?.click()} disabled={scanBusy}
                    title="Read a scanned surveyor report (JPG/PNG/PDF) and fill a new row"
                    style={{ ...s.btn('ghost'), padding: '4px 12px', fontSize: 10,
                      color: T.amber, borderColor: T.amber, opacity: scanBusy ? 0.6 : 1 }}>
                    {scanBusy ? 'READING…' : '📷 SCAN REPORT'}
                  </button>
                  <button onClick={addIncoming} style={{ ...s.btn('ghost'), padding: '4px 12px', fontSize: 10 }}>
                    + ADD ROW
                  </button>
                </div>
              )}
            </div>
            {scanMsg && (
              <div style={{ fontSize: 10, color: T.textDim, marginBottom: 10,
                border: `1px solid ${T.border}`, borderRadius: 4, padding: '6px 10px' }}>
                {scanMsg}
              </div>
            )}
            {draft.incoming.length === 0 ? (
              <div style={{ color: T.textFaint, fontSize: 12, padding: '8px 0' }}>No incoming cargo recorded.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {draft.incoming.map(r => {
                  const r4 = r4Of(r);
                  return (
                    <div key={r.id} style={{ border: `1px solid ${r._fromScan ? T.amber : T.border}`, borderRadius: 6, padding: 14 }}>
                      {r._fromScan && (
                        <div style={{ fontSize: 9, color: T.amber, letterSpacing: 1, marginBottom: 8 }}>
                          ✦ FILLED FROM SCAN — review figures before saving
                        </div>
                      )}
                      {/* Header: date, cargo ref, notes, actions */}
                      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr auto', gap: 12, alignItems: 'end', marginBottom: 12 }}>
                        <Field label="Date">
                          {editable
                            ? <input style={s.input} type="date" value={r.date || ''}
                                onChange={e => setIncoming(r.id, 'date', e.target.value)} />
                            : <div style={{ fontSize: 12 }}>{r.date}</div>}
                        </Field>
                        <Field label="Cargo Ref">
                          {editable
                            ? <input style={s.input} value={r.cargoRef || ''}
                                onChange={e => setIncoming(r.id, 'cargoRef', e.target.value)} />
                            : <div style={{ fontSize: 12 }}>{r.cargoRef || '—'}</div>}
                        </Field>
                        <Field label="Notes">
                          {editable
                            ? <input style={s.input} value={r.notes || ''}
                                onChange={e => setIncoming(r.id, 'notes', e.target.value)} />
                            : <div style={{ fontSize: 12 }}>{r.notes || '—'}</div>}
                        </Field>
                        <div style={{ whiteSpace: 'nowrap' }}>
                          <button onClick={() => openPermit(r)}
                            title="Print a Delivery Order for the port-authority bunker permit"
                            style={{ ...s.btn('ghost'), padding: '6px 12px', fontSize: 10, marginRight: 6,
                              color: r.permit ? T.amber : T.text, borderColor: r.permit ? T.amber : T.border }}>
                            PERMIT DO
                          </button>
                          {editable && (
                            <button onClick={() => delIncoming(r.id)}
                              style={{ ...s.btn('ghost'), padding: '6px 12px', fontSize: 10, color: T.red }}>DEL</button>
                          )}
                        </div>
                      </div>

                      {/* 4 loading points + computed R4 */}
                      <div style={{ fontSize: 9, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>
                        LOADING INFORMATION · observed liters mandatory
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                        {loadPointEditor(r, 'bl',     'B/L', 'Shore / loading figure')}
                        {loadPointEditor(r, 'sfal',   'SFAL (R1)', 'Ship figure after loading')}
                        {loadPointEditor(r, 'sfbd',   'SFBD (R2)', 'Ship figure before discharge')}
                        {loadPointEditor(r, 'actual', 'Actual Received', 'Final figure into stock')}
                      </div>

                      {/* R4 = Actual − B/L (auto) */}
                      <div style={{ marginTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap',
                        background: T.amberGlow, borderRadius: 4, padding: '8px 12px' }}>
                        <div style={{ fontSize: 10, color: T.amber, letterSpacing: 1, alignSelf: 'center' }}>
                          R4 · ACTUAL − B/L
                        </div>
                        <div style={{ fontSize: 11, color: T.textDim }}>
                          Observed: <span style={{ fontFamily: T.font, color: r4.obs != null && r4.obs < 0 ? T.red : T.text }}>
                            {r4.obs == null ? '—' : fmtL(r4.obs) + ' L'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: T.textDim }}>
                          @15°C: <span style={{ fontFamily: T.font, color: r4.l15 != null && r4.l15 < 0 ? T.red : T.text }}>
                            {r4.l15 == null ? '—' : fmtL(r4.l15) + ' L'}
                          </span>
                        </div>
                      </div>

                      {permitOpen === r.id && permitEditor(r)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dispatched section */}
          <div style={{ ...s.card, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5 }}>
                DISPATCHED (D) — {sel.bucket} · from Delivery Orders
              </div>
              {editable && (
                <button onClick={syncDispatched} style={{ ...s.btn('ghost'), padding: '4px 12px', fontSize: 10 }}>
                  ⟳ SYNC FROM DOs
                </button>
              )}
            </div>
            {(!draft.dispatched || draft.dispatched.length === 0) ? (
              <div style={{ color: T.textFaint, fontSize: 12, padding: '8px 0' }}>
                No dispatched entries. Click “Sync from DOs” to pull matching delivery orders.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>DATE</th>
                    <th style={s.th}>DO NUMBER</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>DISPATCHED (L)</th>
                    <th style={s.th}>NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.dispatched.map(r => (
                    <tr key={r.id}>
                      <td style={s.td}>{r.date}</td>
                      <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>{r.doNumber}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(r.dispatchedL)}</td>
                      <td style={s.td}>
                        {editable
                          ? <input style={s.input} value={r.notes || ''}
                              onChange={e => patch({ dispatched: draft.dispatched.map(x => x.id === r.id ? { ...x, notes: e.target.value } : x) })} />
                          : r.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {locked ? (
              <div style={{ fontSize: 12, color: T.red }}>🔒 Locked — read-only.</div>
            ) : editable ? (
              <>
                <button onClick={save} disabled={busy || !dirty} style={{ ...s.btn('primary'), opacity: (busy || !dirty) ? 0.5 : 1 }}>
                  {busy ? 'SAVING…' : 'SAVE'}
                </button>
                {draft.status === 'open' && (
                  <button onClick={close} disabled={busy} style={s.btn('ghost')}>CLOSE MONTH</button>
                )}
                {draft.status === 'closed' && (
                  <>
                    <button onClick={reopen} disabled={busy} style={s.btn('ghost')}>RE-OPEN</button>
                    <button onClick={lock} disabled={busy} style={{ ...s.btn('ghost'), color: T.red }}>LOCK</button>
                  </>
                )}
                {stored?.closedBy && (
                  <span style={{ fontSize: 10, color: T.textDim, marginLeft: 8 }}>
                    Closed by {stored.closedBy}{stored.closedAt ? ` · ${new Date(stored.closedAt).toLocaleString('id-ID')}` : ''}
                  </span>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.textDim }}>View-only — you don’t have edit access to stock cards.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- small presentational helpers ------------------------------------------
function Field({ label, children }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  );
}
function Hint({ children }) {
  return <div style={{ fontSize: 9, color: T.textFaint, marginTop: 4 }}>{children}</div>;
}
function Metric({ label, value, hint, strong, color }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      <div style={{ fontFamily: T.font, fontSize: strong ? 16 : 14,
        color: color || (strong ? T.amber : T.text), textAlign: 'right', padding: '6px 0' }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 9, color: T.textFaint, textAlign: 'right' }}>{hint}</div>}
    </div>
  );
}
