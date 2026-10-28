import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, ISSUERS, CARGO_OWNER } from '../config';
import { useCollection } from './useCollection';
import { buildBASTHtml } from './bastGen';
import VolumeInput from './VolumeInput';
import { USI_LOGO } from './assets';
import { makeQR } from './qr';
import { usePagination, PaginationBar, useIsNarrow, diffDOtoBAST, useSort, SortHeader, StatusPill, MobileSortBar,
  ReasonDialog, useRefFilters, RefFilterInputs, DocLink, FocusBanner, cancelInfoLine } from './listUtils';
import { canFill } from '../roles';
import { auth } from '../firebase';

// BAST status → pill color/label. Completed BASTs are the only ones in the
// bottom list; blank ones live in the strip above.
const bastPill = (b) => b.status === 'blank'
  ? { color: 'var(--text-dim)', label: 'blank (pre-bunker)' }
  : { color: 'var(--green)', label: 'completed' };

// Roles permitted to reopen a completed BAST (and, elsewhere, approve). Defined
// locally so this module doesn't depend on an isApprover export existing in
// roles.js (which has changed across revisions).
const APPROVER_ROLES = ['superadmin', 'director', 'supervisor'];
const isApprover = (role) => APPROVER_ROLES.includes(role);

// Today's date in LOCAL time (toISOString is UTC — before 07:00 WIB it gave yesterday).
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
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

export default function BASTModule({ role, focus, onNavigate, canOpen = () => true, onClearFocus }) {
  const approver = isApprover(role); // supervisor / director / superadmin
  const canReset = canFill(role, 'bast');   // operator and up may RESET a filled BAST
  const bastC = useCollection(COL.bast);
  const doC   = useCollection(COL.deliveryOrders);
  const srC   = useCollection(COL.salesRequests);   // for the client PO reference

  const [form, setForm]     = useState(null);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [syncBusy, setSyncBusy] = useState({});

  const narrow = useIsNarrow();

  // Void state per BAST, derived from its DO and SO (display only, no writes):
  //   'deleted'   — the DO no longer exists (e.g. deleted before the cascade fix)
  //   'cancelled' — the DO or its sales order is cancelled
  // Voided BASTs leave the fill queue and show in the bottom list as ✗ / !.
  const voidOf = useMemo(() => {
    if (doC.loading || srC.loading) return {};
    const doMap = {}; for (const d of doC.data) doMap[d.id] = d;
    const soMap = {}; for (const r of srC.data) soMap[r.id] = r;
    const m = {};
    for (const b of bastC.data) {
      if (b.status === 'cancelled') { m[b.id] = 'cancelled'; continue; }
      if (!b.deliveryOrderId) continue;
      const d = doMap[b.deliveryOrderId];
      if (!d) { m[b.id] = 'deleted'; continue; }
      const so = d.salesRequestId ? soMap[d.salesRequestId] : null;
      if (d.status === 'cancelled' || so?.status === 'cancelled') m[b.id] = 'cancelled';
    }
    return m;
  }, [bastC.data, doC.data, srC.data, doC.loading, srC.loading]);

  // Client PO reference per BAST: BAST → its DO → that DO's sales order.
  // Falls back to the PO stored on the DO itself.
  const poRefByBast = useMemo(() => {
    const doMap = {}; for (const d of doC.data) doMap[d.id] = d;
    const soMap = {}; for (const r of srC.data) soMap[r.id] = r;
    const m = {};
    for (const b of bastC.data) {
      const d = doMap[b.deliveryOrderId];
      const so = d ? soMap[d.salesRequestId] : null;
      m[b.id] = so?.galleyPoRef || d?.clientPoRef || '';
    }
    return m;
  }, [bastC.data, doC.data, srC.data]);
  const poRefOf = (b) => poRefByBast[b.id] || '';

  // Client PO ref / entity / vessel filters (shared with SO and DO pages).
  const refF = useRefFilters(bastC.data, {
    po: poRefOf, entity: b => b.recipient?.entityName, vessel: b => b.recipient?.vesselName });
  // Arrived via a link → only that BAST (in whichever list it belongs).
  const baseBASTs = focus ? bastC.data.filter(b => b.id === focus.id) : refF.filtered;
  const narrowed = !!focus || refF.active;   // priority reorder is off while narrowed

  // Blank BASTs awaiting fill — OLDEST first (longest-waiting surfaces at top),
  // tiebreak by sequence number ascending.
  // Blank BASTs awaiting fill. Ordering: items with an explicit `priority` come
  // first in ascending priority; anything un-prioritized falls back to oldest
  // date (then sequence). So the default view is by date until a user reorders.
  const blankBASTs = useMemo(() => {
    const hasP = b => b.priority !== undefined && b.priority !== null && b.priority !== '';
    return baseBASTs
      .filter(b => b.status === 'blank' && !voidOf[b.id])
      .sort((a, b) => {
        const ap = hasP(a), bp = hasP(b);
        if (ap && bp) return Number(a.priority) - Number(b.priority);
        if (ap !== bp) return ap ? -1 : 1; // prioritized before un-prioritized
        const d = String(a.tanggalBast || '').localeCompare(String(b.tanggalBast || ''));
        if (d !== 0) return d;
        return bastSeq(a) - bastSeq(b);
      });
  }, [baseBASTs, voidOf]);

  // Bottom list is COMPLETED (filled) BASTs only — newest first, seq desc tiebreak.
  // Blank ones live only in the strip above, so the two sections never overlap.
  const completedBASTs = useMemo(() => {
    return baseBASTs
      .filter(b => b.status !== 'blank' || !!voidOf[b.id])
      .sort((a, b) => {
        const d = String(b.tanggalBast || '').localeCompare(String(a.tanggalBast || ''));
        if (d !== 0) return d;
        return bastSeq(b) - bastSeq(a);
      });
  }, [baseBASTs, voidOf]);


  // Sortable columns for the completed list.
  const sortCols = useMemo(() => ({
    nomorBast: b => bastSeq(b),
    date:      b => b.tanggalBast || '',
    client:    b => b.recipient?.entityName || '',
    vessel:    b => b.recipient?.vesselName || '',
    doRef:     b => b.supplier?.deliveryOrder || '',
    poRef:     b => poRefByBast[b.id] || '',
    received:  b => Number(b.qty?.volumeObserved ?? b.qty?.literStandard) || 0,
    loss:      b => Number(b.transitLossL) || 0,
  }), [poRefByBast]);
  const { sorted: sortedBASTs, sortKey, sortDir, toggle, setSort } = useSort(completedBASTs, sortCols);

  const pg      = usePagination(sortedBASTs, 20);  // completed list pager
  const blankPg = usePagination(blankBASTs, 20);   // independent blank-strip pager

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
    // Keep the last recorded date (set when the blank was printed); today only if none.
    if (!copy.tanggalBast) copy.tanggalBast = todayISO();
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

  // Received volume is now the observed liters (no @15°C correction).
  // Transit loss = dispatched − observed received.
  const transitLoss = form
    ? (Number(form.dispatchedVolumeL) || 0) - (Number(form.qty.volumeObserved) || 0)
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
    if (!form.qty.volumeObserved) { alert('Volume Observed (liter) is required.'); return; }
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
      // Operator writes ONLY the BAST. The linked DO (→ 'delivered') and SO
      // (→ 'bast_done') status flips are performed server-side by a Cloud Function
      // that triggers on this BAST reaching 'bast_done'. This keeps operators from
      // needing write access to deliveryOrders / salesRequests (which the Firestore
      // rules deny them) — the earlier in-app cascade was what caused the
      // "missing authentication" error on operator saves.
      await bastC.update(editId, payload);
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

  // A BAST whose DO no longer exists (e.g. left behind by an older delete).
  const isOrphan = (b) => voidOf[b.id] === 'deleted';

  // Small tag next to the BAST number for voided BASTs.
  const voidBadge = (b) => {
    const v = voidOf[b.id];
    if (!v) return null;
    const c = v === 'deleted' ? T.red : T.amber;
    return (
      <span title={v === 'deleted' ? 'Its delivery order no longer exists — safe to delete'
                                   : 'Its delivery order / sales order is cancelled'}
        style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: c, border: `1px solid ${c}`,
          borderRadius: 3, padding: '0 4px' }}>
        {v === 'deleted' ? 'DO DELETED' : 'CANCELLED'}
      </span>
    );
  };

  // Status mark: ✓ completed · ✗ DO deleted · ! cancelled · ○ blank.
  const statusMark = (b) => {
    const v = voidOf[b.id];
    const [ch, color, title] =
      v === 'deleted'   ? ['✗', T.red,   'Voided — delivery order deleted'] :
      v === 'cancelled' ? ['!', T.amber, 'Voided — cancelled'] :
      b.status === 'blank' ? ['○', T.textFaint, 'Blank (pre-bunker)'] :
                          ['✓', T.green, 'Completed'];
    return <span title={title} style={{ color, fontSize: 15, fontWeight: 700 }}>{ch}</span>;
  };

  // PRINT BLANK: the printed date is the day it is printed. The new date is saved
  // on the BAST (so a later reprint updates it again), and the FILL form then
  // starts from this last recorded date.
  const printBlank = async (b) => {
    const today = todayISO();
    let toPrint = b;
    if (b.tanggalBast !== today) {
      const d = new Date(today + 'T00:00:00');
      const stamp = {
        tanggalBast: today,
        tanggalBastText: `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        hari: INDO_DAYS[d.getDay()],
      };
      toPrint = { ...b, ...stamp };
      try {
        await bastC.update(b.id, stamp);
      } catch (e) {
        alert(`Printed with today's date, but couldn't save it on BAST ${b.nomorBast}: ${e.message}`);
      }
    }
    await printBAST(toPrint);
  };

  // RESET a filled BAST back to blank (operator and up). Typical reason: the
  // client needs a different date printed. The BAST keeps its number; who / when /
  // why is appended to resetHistory. Setting status to 'blank' makes the Cloud
  // Function revert the linked DO (→ issued) and SO (→ do_issued) — unless they
  // are cancelled. Nothing is ever deleted.
  const [resetTarget, setResetTarget] = useState(null);
  const doReset = async (reason) => {
    const b = resetTarget;
    const entry = { reason, by: auth.currentUser?.email || '', at: new Date().toISOString(), fromStatus: b.status };
    try {
      await bastC.update(b.id, {
        status: 'blank',
        lastResetReason: entry.reason, lastResetBy: entry.by, lastResetAt: entry.at,
        resetHistory: [...(b.resetHistory || []), entry],
      });
      setResetTarget(null);
    } catch (e) {
      alert('Error resetting BAST: ' + e.message);
    }
  };

  // Reorder a blank BAST up/down the fill queue. Anyone may reorder. On the first
  // move we materialise the current visual order into explicit `priority` numbers
  // (0,1,2…), swap the moved item with its neighbour, and persist only the two
  // rows whose priority actually changed. `dir` is -1 (up) or +1 (down).
  const [moveBusy, setMoveBusy] = useState(false);
  const moveBlank = async (b, dir) => {
    if (moveBusy || narrowed) return;
    const order = blankBASTs;                 // already in display order
    const i = order.findIndex(x => x.id === b.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return; // at an edge
    setMoveBusy(true);
    try {
      // Assign sequential priorities with i and j swapped.
      const nextIds = order.map(x => x.id);
      [nextIds[i], nextIds[j]] = [nextIds[j], nextIds[i]];
      // Persist only rows whose priority changes (keeps writes minimal).
      const writes = [];
      nextIds.forEach((id, idx) => {
        const cur = order.find(x => x.id === id);
        if (Number(cur.priority) !== idx) writes.push(bastC.update(id, { priority: idx }));
      });
      await Promise.all(writes);
    } catch (e) {
      alert('Error reordering: ' + e.message);
    } finally {
      setMoveBusy(false);
    }
  };

  const fmtL = n => (Number(n) || 0).toLocaleString('id-ID');
  const toDO = (b) => { const d = doById[b.deliveryOrderId]; if (d) onNavigate?.('do', d.id, d.brNo); };
  // Cancellation note: the BAST's own reason, else its DO's / SO's.
  const cancelNote = (b) => {
    if (b.cancelReason) return cancelInfoLine(b);
    const d = doById[b.deliveryOrderId];
    return d?.cancelReason ? cancelInfoLine(d) : '';
  };
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

      {/* Arrived via a link: one record only */}
      {focus && <FocusBanner label={focus.label} onClear={onClearFocus} />}

      {/* Filters: client PO ref, entity, vessel (apply to both lists) */}
      {!form && !focus && bastC.data.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            FILTERS {refF.active && <span style={{ color: T.amber }}>· {baseBASTs.length} of {bastC.data.length} shown</span>}
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <RefFilterInputs f={refF} />
            {refF.active && <button onClick={refF.clear} style={{ ...s.btn('ghost'), fontSize: 11 }}>CLEAR FILTERS</button>}
          </div>
        </div>
      )}

      {/* Blank BASTs awaiting fill */}
      {!form && blankBASTs.length > 0 && (
        <div style={{ ...s.card, marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
            BLANK BASTs — PRINT PRE-BUNKER, FILL AFTER LOADING · {narrowed ? 'clear filters to reorder' : '↑↓ TO PRIORITISE'}
          </div>
          {blankPg.pageRows.map(b => {
            const idx = blankBASTs.findIndex(x => x.id === b.id); // position in full queue
            return (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Priority rank + reorder arrows */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontFamily: T.font, fontSize: 11, color: T.amber, minWidth: 20, textAlign: 'right' }}>#{idx + 1}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 2 }}>
                      <button onClick={() => moveBlank(b, -1)} disabled={moveBusy || narrowed || idx === 0}
                        title="Move up" style={{ ...s.btn('ghost'), padding: '0 6px', fontSize: 9, lineHeight: '14px',
                          opacity: (moveBusy || idx === 0) ? 0.3 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}>▲</button>
                      <button onClick={() => moveBlank(b, 1)} disabled={moveBusy || narrowed || idx === blankBASTs.length - 1}
                        title="Move down" style={{ ...s.btn('ghost'), padding: '0 6px', fontSize: 9, lineHeight: '14px',
                          opacity: (moveBusy || idx === blankBASTs.length - 1) ? 0.3 : 1, cursor: idx === blankBASTs.length - 1 ? 'default' : 'pointer' }}>▼</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ color: T.amber, fontFamily: T.font, fontSize: 11 }}>{b.nomorBast}</span>{voidBadge(b)}
                    <span style={{ color: T.textDim }}> · {b.tanggalBast} · DO </span>
                    {doById[b.deliveryOrderId] && canOpen('do')
                      ? <DocLink label={b.supplier?.deliveryOrder} title="Open this delivery order" onClick={() => toDO(b)} />
                      : <span style={{ color: T.textDim }}>{b.supplier?.deliveryOrder}</span>}
                    <span style={{ color: T.textDim }}> · PO {poRefOf(b) || '—'} · {clientOf(b)} · {vesselOf(b)} · {fmtL(b.dispatchedVolumeL)} L</span>
                    {b.lastResetReason && (
                      <div style={{ fontSize: 10, color: T.amber, marginTop: 2 }}>
                        Reset: {b.lastResetReason}{b.lastResetBy ? ` · ${b.lastResetBy}` : ''}{b.lastResetAt ? ` · ${new Date(b.lastResetAt).toLocaleDateString('id-ID')}` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => printBlank(b)} title="Prints with today's date and saves it on this BAST"
                    style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>
                    PRINT BLANK
                  </button>
                  <button onClick={() => startEdit(b)} style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 10 }}>
                    FILL →
                  </button>
                </div>
              </div>
            );
          })}
          <PaginationBar {...blankPg} />
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
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
            <div>
              <label style={s.label}>Volume Observed / Received (R)</label>
              <VolumeInput value={form.qty.volumeObserved}
                onChange={v => setNested('qty.volumeObserved', v)} placeholder="observed liter" />
            </div>
            <div>
              <label style={s.label}>Dispatched (D)</label>
              <input style={{ ...s.input, opacity: .6 }} value={fmtL(form.dispatchedVolumeL)} disabled />
            </div>
            <div>
              <label style={s.label}>Transit Loss (D−R obs)</label>
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

      {/* Completed BAST list */}
      <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, margin: '4px 0 10px' }}>
        COMPLETED &amp; CLOSED BASTs
        <span style={{ marginLeft: 10, letterSpacing: 0.5, color: T.textFaint }}>
          <span style={{ color: T.green, fontWeight: 700 }}>✓</span> completed ·{' '}
          <span style={{ color: T.red, fontWeight: 700 }}>✗</span> DO deleted ·{' '}
          <span style={{ color: T.amber, fontWeight: 700 }}>!</span> cancelled
        </span>
      </div>
      {bastC.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : sortedBASTs.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No completed BAST records yet.</div>
      ) : narrow ? (
        // -------- Mobile: stacked cards --------
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MobileSortBar sortKey={sortKey} sortDir={sortDir} setSort={setSort}
            options={[{ key: 'nomorBast', label: 'BAST number' }, { key: 'date', label: 'Date' }, { key: 'poRef', label: 'Client PO ref' }, { key: 'client', label: 'Client' }, { key: 'vessel', label: 'Vessel' }, { key: 'doRef', label: 'DO ref' }, { key: 'received', label: 'Received' }, { key: 'loss', label: 'Transit loss' }]} />
          {pg.pageRows.map(b => {
            const diffs = voidOf[b.id] ? [] : diffsForBAST(b);
            return (
              <div key={b.id} style={{ ...s.card, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: T.font, color: T.amber, fontSize: 11 }}>{b.nomorBast}</span>{voidBadge(b)}
                  {statusMark(b)}
                </div>
                <div style={{ fontSize: 13, color: T.text }}>{clientOf(b)}</div>
                {voidOf[b.id] === 'cancelled' && cancelNote(b) && (
                  <div style={{ fontSize: 10, color: T.red, marginTop: 2 }}>{cancelNote(b)}</div>
                )}
                <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <span>{b.tanggalBast}</span>
                  <span>· {vesselOf(b)}</span>
                  <span style={{ fontFamily: T.font }}>· DO </span>
                  {doById[b.deliveryOrderId] && canOpen('do')
                    ? <DocLink label={b.supplier?.deliveryOrder} title="Open this delivery order" onClick={() => toDO(b)} />
                    : <span style={{ fontFamily: T.font }}>{b.supplier?.deliveryOrder || '—'}</span>}
                  <span style={{ fontFamily: T.font, color: T.text }}>· PO {poRefOf(b) || '—'}</span>
                </div>
                <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <span>Received: <span style={{ fontFamily: T.font, color: T.text }}>{b.status === 'blank' ? '—' : fmtL(b.qty?.volumeObserved ?? b.qty?.literStandard)}</span></span>
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
                  {!voidOf[b.id] && <>
                  <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>PDF</button>
                  <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10 }}>
                    {b.status === 'blank' ? 'FILL' : 'EDIT'}
                  </button>
                  </>}
                  {diffs.length > 0 && (
                    <button onClick={() => syncFromDO(b)} disabled={syncBusy[b.id]}
                      style={{ ...s.btn('primary'), padding: '5px 12px', fontSize: 10 }}>
                      {syncBusy[b.id] ? 'SYNCING…' : 'SYNC FROM DO'}
                    </button>
                  )}
                  {canReset && b.status !== 'blank' && !voidOf[b.id] && (
                    <button onClick={() => setResetTarget(b)} title="Back to blank (e.g. to print a different date) — number is kept"
                      style={{ ...s.btn('ghost'), padding: '5px 12px', fontSize: 10, color: T.amber, borderColor: T.amber }}>RESET</button>
                  )}
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
                <SortHeader label="BAST NUMBER" colKey="nomorBast" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="DATE" colKey="date" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="CLIENT PO" colKey="poRef" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="CLIENT" colKey="client" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="VESSEL" colKey="vessel" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortHeader label="DO REF" colKey="doRef" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <th style={{ ...s.th, textAlign: 'center', width: 32 }} title="Completed">✓</th>
                <SortHeader label="RECEIVED (L)" colKey="received" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortHeader label="TRANSIT LOSS" colKey="loss" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageRows.map(b => {
                const diffs = voidOf[b.id] ? [] : diffsForBAST(b);
                return (
                  <tr key={b.id}>
                    <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 11 }}>
                      {b.nomorBast}
                      {voidBadge(b)}
                      {diffs.length > 0 && <span title={`Differs from DO (${diffs.length} field(s))`} style={{ color: T.amber, marginLeft: 6 }}>⚠</span>}
                    </td>
                    <td style={s.td}>{b.tanggalBast}</td>
                    <td style={{ ...s.td, fontFamily: T.font, fontSize: 10, color: T.text }}>{poRefOf(b) || '—'}</td>
                    <td style={s.td}>
                      {clientOf(b)}
                      {voidOf[b.id] === 'cancelled' && cancelNote(b) && (
                        <div style={{ fontSize: 9, color: T.red, marginTop: 2 }}>{cancelNote(b)}</div>
                      )}
                    </td>
                    <td style={s.td}>{vesselOf(b)}</td>
                    <td style={{ ...s.td, fontFamily: T.font, fontSize: 10 }}>
                      {doById[b.deliveryOrderId] && canOpen('do')
                        ? <DocLink label={b.supplier?.deliveryOrder} title="Open this delivery order" onClick={() => toDO(b)} />
                        : b.supplier?.deliveryOrder}
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {statusMark(b)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>
                      {b.status === 'blank' ? '—' : fmtL(b.qty?.volumeObserved ?? b.qty?.literStandard)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: b.transitLossL > 0 ? T.red : T.text }}>
                      {b.status === 'blank' ? '—' : fmtL(b.transitLossL)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!voidOf[b.id] && <>
                      <button onClick={() => printBAST(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>PDF</button>
                      <button onClick={() => startEdit(b)} style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6 }}>
                        {b.status === 'blank' ? 'FILL' : 'EDIT'}
                      </button>
                      </>}
                      {diffs.length > 0 && (
                        <button onClick={() => syncFromDO(b)} disabled={syncBusy[b.id]}
                          style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, marginRight: 6, color: T.amber, borderColor: T.amber }}>
                          {syncBusy[b.id] ? 'SYNC…' : 'SYNC'}
                        </button>
                      )}
                      {canReset && b.status !== 'blank' && !voidOf[b.id] && (
                        <button onClick={() => setResetTarget(b)} title="Back to blank (e.g. to print a different date) — number is kept"
                          style={{ ...s.btn('ghost'), padding: '3px 10px', fontSize: 10, color: T.amber, borderColor: T.amber }}>RESET</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationBar {...pg} />
        </>
      )}

      {resetTarget && (
        <ReasonDialog title={`RESET BAST ${resetTarget.nomorBast}`}
          message={`The BAST goes back to the blank list so it can be printed and filled again ` +
            `(e.g. with the date the client needs). It keeps its number ${resetTarget.nomorBast}.` +
            `\nIts DO and sales order go back to their pre-delivery status until it is filled again.` +
            `\n\nWho, when and why are recorded.`}
          placeholder="e.g. Client needs delivery date 18 Oct on the BAST"
          confirmLabel="RESET BAST"
          onConfirm={doReset} onCancel={() => setResetTarget(null)} />
      )}
    </div>
  );
}
