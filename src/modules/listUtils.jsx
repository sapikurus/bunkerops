import { useState, useEffect, useMemo } from 'react';
import { T, s } from '../tokens';

// ---------------------------------------------------------------------------
// useIsNarrow — true below a breakpoint. Drives table→card switch on mobile.
// No hardcoded colors; layout-only.
// ---------------------------------------------------------------------------
export function useIsNarrow(breakpoint = 720) {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return narrow;
}

// ---------------------------------------------------------------------------
// usePagination — client-side paging over an array. Default page size 20,
// user-editable. Resets to page 1 when the underlying list length shrinks
// below the current window or the page size changes.
// ---------------------------------------------------------------------------
export function usePagination(rows, initialSize = 20) {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);

  const total      = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keep the current page in range as data / size changes.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(total, page * pageSize);

  return { page, setPage, pageSize, setPageSize, totalPages, pageRows, total, from, to };
}

// ---------------------------------------------------------------------------
// PaginationBar — page controls + editable page-size box. Pure token styling.
// ---------------------------------------------------------------------------
export function PaginationBar({ page, setPage, totalPages, pageSize, setPageSize, total, from, to }) {
  if (total === 0) return null;

  const sizeBox = {
    ...s.input,
    width: 64,
    padding: '4px 8px',
    fontSize: 11,
    textAlign: 'center',
  };
  const navBtn = (disabled) => ({
    ...s.btn('ghost'),
    padding: '4px 12px',
    fontSize: 10,
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'default' : 'pointer',
  });

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, marginTop: 14,
    }}>
      <div style={{ fontSize: 11, color: T.textDim, fontFamily: T.font }}>
        {from}–{to} of {total}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: T.textFaint, letterSpacing: 1 }}>PER PAGE</span>
          <input
            style={sizeBox}
            type="number"
            min={1}
            value={pageSize}
            onChange={e => {
              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
              setPageSize(v);
              setPage(1);
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={navBtn(page <= 1)} disabled={page <= 1} onClick={() => setPage(1)}>« FIRST</button>
          <button style={navBtn(page <= 1)} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ PREV</button>
          <span style={{ fontSize: 11, color: T.text, fontFamily: T.font, minWidth: 90, textAlign: 'center' }}>
            {page} / {totalPages}
          </span>
          <button style={navBtn(page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>NEXT ›</button>
          <button style={navBtn(page >= totalPages)} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>LAST »</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SO → DO discrepancy detection.
// Compares the fields a DO inherits from its parent SO. Returns an array of
// { label, so, doVal } for every field that now differs. Empty => in sync.
// Note: DO number encodes issuer + node; scheme/node drift is flagged with a
// hard warning because applying it would leave the existing DO number wrong.
// ---------------------------------------------------------------------------
const norm = v => (v === undefined || v === null) ? '' : String(v).trim();
const numEq = (a, b) => (Number(a) || 0) === (Number(b) || 0);

export function diffSOtoDO(so, d) {
  if (!so || !d) return [];
  const out = [];
  const push = (label, soV, doV, opts = {}) => out.push({ label, so: soV, doVal: doV, ...opts });

  if (norm(so.entityName) !== norm(d.deliverTo))
    push('Deliver To', so.entityName, d.deliverTo, { field: 'deliverTo', value: so.entityName });
  if (norm(so.deliveryLocation) !== norm(d.deliverLocation))
    push('Location', so.deliveryLocation, d.deliverLocation, { field: 'deliverLocation', value: so.deliveryLocation });
  if (norm(so.vesselName) !== norm(d.vesselName))
    push('Vessel', so.vesselName, d.vesselName, { field: 'vesselName', value: so.vesselName });

  const soFuel = so.fuelTypeName || so.fuelTypeShort || '';
  if (norm(soFuel) !== norm(d.fuelDescription) && norm(soFuel) !== norm(d.items?.[0]?.description))
    push('Fuel', soFuel, d.fuelDescription || d.items?.[0]?.description, { field: 'fuelDescription', value: soFuel });

  if (!numEq(so.requestedVolumeL, d.dispatchedVolumeL))
    push('Volume (L)', so.requestedVolumeL, d.dispatchedVolumeL, {
      field: 'dispatchedVolumeL', value: Number(so.requestedVolumeL) || 0, numeric: true,
    });

  // Scheme / node drift — affects DO number, cannot be silently re-applied.
  if (norm(so.scheme) !== norm(d.scheme))
    push('Scheme', so.scheme, d.scheme, { field: 'scheme', value: so.scheme, breaksNumber: true });
  if (norm(so.bucket) !== norm(d.bucket))
    push('Bucket', so.bucket, d.bucket, { field: 'bucket', value: so.bucket, breaksNumber: true });
  if (norm(so.nodeId) !== norm(d.nodeId))
    push('Node', so.nodeName || so.nodeCode, d.deliveredFrom || d.nodeCode, { field: 'nodeId', value: so.nodeId, breaksNumber: true });

  return out;
}

// ---------------------------------------------------------------------------
// DO → BAST discrepancy detection (only meaningful while BAST is 'blank').
// Returns changed inherited fields as { label, doVal, bastVal }.
// ---------------------------------------------------------------------------
export function diffDOtoBAST(d, b) {
  if (!d || !b) return [];
  const out = [];
  const push = (label, doV, bastV) => out.push({ label, doVal: doV, bastVal: bastV });

  if (norm(d.brNo) !== norm(b.supplier?.deliveryOrder))
    push('DO Number', d.brNo, b.supplier?.deliveryOrder);
  if (norm(d.deliverTo) !== norm(b.recipient?.entityName))
    push('Recipient', d.deliverTo, b.recipient?.entityName);
  if (norm(d.vesselName) !== norm(b.recipient?.vesselName))
    push('Receiving Vessel', d.vesselName, b.recipient?.vesselName);
  if (norm(d.deliveredFrom) !== norm(b.deliveredFrom?.facility))
    push('Delivered From', d.deliveredFrom, b.deliveredFrom?.facility);
  if (!numEq(d.dispatchedVolumeL, b.dispatchedVolumeL))
    push('Dispatched (L)', d.dispatchedVolumeL, b.dispatchedVolumeL);

  return out;
}

// Build the BAST patch that brings a blank BAST back in line with its DO.
// Mirrors the auto-create mapping in DeliveryOrders.save().
export function bastPatchFromDO(d, cargoOwner) {
  const patch = {
    supplier:      { ...(d._bastSupplier || {}), name: cargoOwner, deliveryOrder: d.brNo },
    recipient:     { entityName: d.deliverTo || '', vesselName: d.vesselName || '', receiverName: '' },
    deliveredFrom: { facility: d.deliveredFrom || '', port: d.nodePort || '' },
    dispatchedVolumeL: Number(d.dispatchedVolumeL) || 0,
  };
  return patch;
}

// ---------------------------------------------------------------------------
// useSort — generic client-side sort over rows by a keyed accessor map.
// `columns` is { key: (row) => comparableValue }. Returns the sorted rows plus
// the active key/dir and a toggle handler for header clicks. Passing the same
// key flips direction; a new key sorts ascending (except date-like defaults).
// `initial` sets the starting sort, e.g. { key: 'date', dir: 'desc' }.
// ---------------------------------------------------------------------------
export function useSort(rows, columns, initial = {}) {
  const [sortKey, setSortKey] = useState(initial.key || null);
  const [sortDir, setSortDir] = useState(initial.dir || 'asc');

  const toggle = (key) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !columns[sortKey]) return rows;
    const get = columns[sortKey];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      // numbers compare numerically; everything else as string (locale).
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
  }, [rows, sortKey, sortDir, columns]);

  // Direct setter (used by the mobile sort bar; key null = default order).
  const setSort = (key, dir = 'asc') => { setSortKey(key || null); setSortDir(dir); };

  return { sorted, sortKey, sortDir, toggle, setSort };
}

// ---------------------------------------------------------------------------
// MobileSortBar — the phone equivalent of clickable SortHeaders. Card views
// have no column headers, so this offers a "Sort by" picker + direction toggle
// driven by the same useSort state the desktop table uses.
//   options: [{ key, label }]  (same keys as the useSort columns)
// ---------------------------------------------------------------------------
export function MobileSortBar({ options, sortKey, sortDir, setSort }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 10, color: T.textDim, letterSpacing: 1, whiteSpace: 'nowrap' }}>SORT BY</span>
      <select value={sortKey || ''} onChange={e => setSort(e.target.value || null, 'asc')}
        style={{ ...s.input, flex: 1, fontSize: 12 }}>
        <option value="">Default order</option>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <button type="button" disabled={!sortKey}
        onClick={() => setSort(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
        title={sortDir === 'asc' ? 'Ascending — tap for descending' : 'Descending — tap for ascending'}
        style={{ ...s.btn('ghost'), padding: '6px 12px', fontSize: 12, opacity: sortKey ? 1 : 0.4,
          color: sortKey ? T.amber : T.textDim }}>
        {sortDir === 'asc' ? '▲' : '▼'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortHeader — a clickable <th> showing the active sort arrow. Pass the same
// sortKey/sortDir/onSort the useSort hook returns. `align` optional ('right').
// ---------------------------------------------------------------------------
export function SortHeader({ label, colKey, sortKey, sortDir, onSort, align }) {
  const active = sortKey === colKey;
  const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={() => onSort(colKey)}
      style={{ ...s.th, textAlign: align || 'left', cursor: 'pointer', userSelect: 'none',
        color: active ? T.amber : s.th.color, whiteSpace: 'nowrap' }}
      title="Click to sort"
    >
      {label}<span style={{ fontSize: 8 }}>{arrow}</span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// StatusPill — soft-tinted rounded badge. `color` is a CSS color (token or hex);
// the background is that color at low opacity so text stays readable in both
// themes. `label` defaults to the raw status with underscores → spaces.
// ---------------------------------------------------------------------------
export function StatusPill({ status, color, label }) {
  const c = color || T.textDim;
  const text = label != null ? label : String(status || '').replace(/_/g, ' ');
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0.5,
      color: c,
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
      borderRadius: 999,
      padding: '2px 9px',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ReasonDialog — modal that requires a written reason before confirming
// (cancel SO, reset BAST). Nothing is deleted in BunkerOps; the reason is what
// lets the team follow up later.
// ---------------------------------------------------------------------------
export function ReasonDialog({ title, message, confirmLabel = 'CONFIRM', placeholder, danger, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3;
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try { await onConfirm(reason.trim()); } finally { setBusy(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div style={{ ...s.card, width: '100%', maxWidth: 460, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: danger ? T.red : T.amber, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 12 }}>{message}</div>
        <label style={s.label}>Reason (required)</label>
        <textarea autoFocus rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder={placeholder || 'Write the reason…'}
          style={{ ...s.input, width: '100%', fontSize: 12, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy} style={{ ...s.btn('ghost'), fontSize: 11 }}>BACK</button>
          <button onClick={submit} disabled={!ok || busy}
            style={{ ...s.btn('primary'), fontSize: 11, opacity: (!ok || busy) ? 0.5 : 1,
              ...(danger ? { background: T.red, borderColor: T.red } : {}) }}>
            {busy ? 'SAVING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reference filters — client PO reference (search), entity, vessel — shared by
// Sales Requests, Delivery Orders and BAST. PO search ignores case, spaces and
// the letter-O / zero mix-up (PO48 finds P048 and vice versa).
// ---------------------------------------------------------------------------
const poSearchKey = (v) => String(v ?? '').toUpperCase().replace(/\s+/g, '').replace(/O/g, '0');

export function useRefFilters(rows, get) {
  const [po, setPo] = useState('');
  const [entity, setEntity] = useState('');
  const [vessel, setVessel] = useState('');
  const uniq = (fn) => [...new Set(rows.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const entityOpts = useMemo(() => uniq(get.entity), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const vesselOpts = useMemo(() => uniq(get.vessel), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    const q = poSearchKey(po);
    return rows.filter(r =>
      (!q || poSearchKey(get.po(r)).includes(q)) &&
      (!entity || get.entity(r) === entity) &&
      (!vessel || get.vessel(r) === vessel));
  }, [rows, po, entity, vessel]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = !!(po || entity || vessel);
  const clear = () => { setPo(''); setEntity(''); setVessel(''); };
  return { filtered, active, clear, po, setPo, entity, setEntity, vessel, setVessel, entityOpts, vesselOpts };
}

// The three filter inputs (render inside an existing filter card / row).
export function RefFilterInputs({ f }) {
  return (
    <>
      <div>
        <label style={s.label}>Client PO Ref</label>
        <input value={f.po} onChange={e => f.setPo(e.target.value)} placeholder="search PO…"
          style={{ ...s.input, width: 170, fontSize: 11 }} />
      </div>
      <div>
        <label style={s.label}>Entity</label>
        <select value={f.entity} onChange={e => f.setEntity(e.target.value)} style={{ ...s.input, width: 220, fontSize: 11 }}>
          <option value="">— all —</option>
          {f.entityOpts.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label style={s.label}>Vessel</label>
        <select value={f.vessel} onChange={e => f.setVessel(e.target.value)} style={{ ...s.input, width: 150, fontSize: 11 }}>
          <option value="">— all —</option>
          {f.vesselOpts.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cross-document links (SO → DO → BAST and back) and the "showing one record"
// banner shown after following a link.
// ---------------------------------------------------------------------------
export function DocLink({ label, onClick, title }) {
  if (!label) return null;
  return (
    <button type="button" onClick={onClick} title={title}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: T.font,
        fontSize: 10, color: T.blue, textDecoration: 'underline', textAlign: 'left' }}>
      {label}
    </button>
  );
}

export function FocusBanner({ label, onClear }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
      border: `1px solid ${T.blue}`, borderRadius: 4, padding: '8px 12px', fontSize: 11 }}>
      <span>Showing <b style={{ fontFamily: T.font }}>{label}</b> only</span>
      <button onClick={onClear} style={{ ...s.btn('ghost'), padding: '2px 10px', fontSize: 10 }}>SHOW ALL</button>
    </div>
  );
}

// Who did it (for cancel / reset audit fields).
export function cancelInfoLine(doc) {
  if (!doc?.cancelReason) return '';
  const when = doc.cancelledAt ? new Date(doc.cancelledAt).toLocaleDateString('id-ID') : '';
  return `Cancelled: ${doc.cancelReason}` + (doc.cancelledBy ? ` · ${doc.cancelledBy}` : '') + (when ? ` · ${when}` : '');
}
