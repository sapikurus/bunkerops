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
