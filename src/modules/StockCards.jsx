import { useState, useEffect, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, BUCKETS, TOLERANCE_PCT } from '../config';
import { useCollection } from './useCollection';
import { canManage } from '../roles';
import VolumeInput from './VolumeInput';

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
function computeCard({ openingROB, incoming, dispatched, measuredROB }) {
  const totalC = (incoming || []).reduce((a, r) => a + (Number(r.volumeL) || 0), 0);
  const totalD = (dispatched || []).reduce((a, r) => a + (Number(r.dispatchedL) || 0), 0);
  const bookROB = (Number(openingROB) || 0) + totalC - totalD;
  const hasMeasured = measuredROB != null && measuredROB !== '';
  const storageLoss = hasMeasured ? bookROB - Number(measuredROB) : null;
  const toleranceAllowance = (TOLERANCE_PCT / 100) * totalC; // 0.3% -> 0.003 * ΣC
  const excessLoss = storageLoss == null ? null : Math.max(0, storageLoss - toleranceAllowance);
  const totalVhsFee = (incoming || [])
    .reduce((a, r) => a + (Number(r.volumeL) || 0) * (Number(r.vhsRatePerL) || 0), 0);
  return { totalC, totalD, bookROB, storageLoss, toleranceAllowance, excessLoss, totalVhsFee };
}

export default function StockCards({ role, user }) {
  const cardsC = useCollection(COL.stockCards);
  const nodesC = useCollection(COL.nodes);
  const doC    = useCollection(COL.deliveryOrders);

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
        incoming:         stored.incoming ? JSON.parse(JSON.stringify(stored.incoming)) : [],
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
  const addIncoming = () => patch({
    incoming: [...draft.incoming, { id: uid(), date: todayISO(), cargoRef: '', volumeL: '', vhsRatePerL: '', notes: '' }],
  });
  const setIncoming = (id, field, v) => patch({
    incoming: draft.incoming.map(r => r.id === id ? { ...r, [field]: v } : r),
  });
  const delIncoming = (id) => patch({ incoming: draft.incoming.filter(r => r.id !== id) });

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
    incoming: draft.incoming.map(r => ({
      id: r.id, date: r.date, cargoRef: r.cargoRef,
      volumeL: Number(r.volumeL) || 0, vhsRatePerL: Number(r.vhsRatePerL) || 0, notes: r.notes,
    })),
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

  // App only routes here for roles with >= view access, so no extra gate here.
  return (
    <div style={{ padding: 40, maxWidth: 1000 }}>
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
              <Metric label="Total VHS Fee" value={fmtRp(computed.totalVhsFee)} />
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
                <button onClick={addIncoming} style={{ ...s.btn('ghost'), padding: '4px 12px', fontSize: 10 }}>
                  + ADD ROW
                </button>
              )}
            </div>
            {draft.incoming.length === 0 ? (
              <div style={{ color: T.textFaint, fontSize: 12, padding: '8px 0' }}>No incoming cargo recorded.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>DATE</th>
                    <th style={s.th}>CARGO REF</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>VOLUME (L)</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>VHS RATE /L</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>VHS FEE</th>
                    <th style={s.th}>NOTES</th>
                    {editable && <th style={s.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {draft.incoming.map(r => (
                    <tr key={r.id}>
                      <td style={s.td}>
                        {editable
                          ? <input style={{ ...s.input, width: 130 }} type="date" value={r.date || ''}
                              onChange={e => setIncoming(r.id, 'date', e.target.value)} />
                          : r.date}
                      </td>
                      <td style={s.td}>
                        {editable
                          ? <input style={s.input} value={r.cargoRef || ''}
                              onChange={e => setIncoming(r.id, 'cargoRef', e.target.value)} />
                          : r.cargoRef}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        {editable
                          ? <VolumeInput value={r.volumeL} onChange={v => setIncoming(r.id, 'volumeL', v)} style={{ width: 120 }} />
                          : fmtL(r.volumeL)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        {editable
                          ? <VolumeInput value={r.vhsRatePerL} onChange={v => setIncoming(r.id, 'vhsRatePerL', v)} style={{ width: 90 }} />
                          : fmtL(r.vhsRatePerL)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: T.textDim }}>
                        {fmtRp((Number(r.volumeL) || 0) * (Number(r.vhsRatePerL) || 0))}
                      </td>
                      <td style={s.td}>
                        {editable
                          ? <input style={s.input} value={r.notes || ''}
                              onChange={e => setIncoming(r.id, 'notes', e.target.value)} />
                          : r.notes}
                      </td>
                      {editable && (
                        <td style={{ ...s.td, textAlign: 'right' }}>
                          <button onClick={() => delIncoming(r.id)}
                            style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.red }}>DEL</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
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
