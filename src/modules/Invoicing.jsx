import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import { COL, PPN_PCT } from '../config';
import { useCollection } from './useCollection';
import { canCommercial } from '../roles';
import { usePagination, PaginationBar, useIsNarrow, useSort, SortHeader } from './listUtils';

// Commercial pricing-control module. Lists DELIVERED (non-cancelled) DOs with the
// 15°C received quantity from their BAST, and lets commercial/director/superadmin
// set per-litre DPP & OAT rates (+ a PBBKB % of DPP, 0 for now) across several
// DOs at once. Amounts compute live:
//   DPP      = dppRate × qty
//   OAT      = oatRate × qty
//   PPN      = 11% × (DPP + OAT)
//   PBBKB    = pbbkbRate% × DPP        (% of DPP only; not charged yet)
//   Subtotal = DPP + OAT + PPN + PBBKB
// Rates persist in bunkerops_invoices (one doc per DO id). This is control/record
// only — actual invoices are generated in a separate app.

// SO status labels for the filter dropdown (same vocabulary as Sales Requests).
const SO_STATUS_LABELS = {
  pending_approval: 'Pending approval',
  requested:        'Requested',
  do_issued:        'DO issued',
  bast_done:        'BAST done',
  reconciled:       'Reconciled',
  cancelled:        'Cancelled',
};

// Money with 2 decimals, id-ID separators: "Rp 1.234.567,89".
const fmtRp = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtL  = (n) => (Number(n) || 0).toLocaleString('id-ID');
const fmtRate = (n) => (n === '' || n == null) ? '—' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Compute the money breakdown for a priced row.
function compute(qty, dppRate, oatRate, pbbkbRate) {
  const q = Number(qty) || 0;
  const dpp = (Number(dppRate) || 0) * q;
  const oat = (Number(oatRate) || 0) * q;
  const ppn = (PPN_PCT / 100) * (dpp + oat);
  const pbbkb = (Number(pbbkbRate) || 0) / 100 * dpp;  // % of DPP only
  const subtotal = dpp + oat + ppn + pbbkb;
  return { dpp, oat, ppn, pbbkb, subtotal };
}

export default function Invoicing({ role, user }) {
  const doC   = useCollection(COL.deliveryOrders);
  const bastC = useCollection(COL.bast);
  const srC   = useCollection(COL.salesRequests);
  const invC  = useCollection(COL.invoices);

  const narrow = useIsNarrow();
  const canWrite = canCommercial(role);

  // Selection + the rate inputs for "apply to selected".
  const [sel, setSel]           = useState({});     // { [doId]: true }
  const [dppRate, setDppRate]   = useState('');
  const [oatRate, setOatRate]   = useState('');
  const [pbbkbRate, setPbbkbRate] = useState('');
  const [busy, setBusy]         = useState(false);

  // BAST (filled) by deliveryOrderId → gives 15°C qty + bast date.
  const bastByDO = useMemo(() => {
    const m = {};
    for (const b of bastC.data) {
      if (b.deliveryOrderId) m[b.deliveryOrderId] = b;
    }
    return m;
  }, [bastC.data]);

  // Invoice (rates) by DO id.
  const invById = useMemo(() => {
    const m = {};
    for (const iv of invC.data) m[iv.id] = iv;
    return m;
  }, [invC.data]);

  // Parent SO by id (for SO number, PO ref, SO date on each row).
  const soById = useMemo(() => {
    const m = {};
    for (const r of srC.data) m[r.id] = r;
    return m;
  }, [srC.data]);

  // Build the billable rows: delivered, non-cancelled DOs, joined to BAST + invoice.
  const rows = useMemo(() => {
    return doC.data
      .filter(d => d.status === 'delivered')
      .map(d => {
        const b = bastByDO[d.id];
        const iv = invById[d.id] || {};
        const so = soById[d.salesRequestId] || {};
        const qty = Number(b?.qty?.literStandard) || 0;   // 15°C received
        const money = compute(qty, iv.dppRate, iv.oatRate, iv.pbbkbRate);
        const priced = iv.dppRate != null && iv.dppRate !== '';
        // Cargo type drives which commercial view applies. Scheme is the source of
        // truth (PPS_SALE = PPS cargo; NON_PPS_SALE = MBSS cargo). Fall back to bucket.
        const scheme = so.scheme || d.scheme || '';
        const bucket = so.bucket || d.bucket || '';
        const cargo = (scheme === 'NON_PPS_SALE' || bucket === 'MBSS') ? 'MBSS' : 'PPS';
        return {
          id: d.id,
          brNo: d.brNo,
          cargo,
          soNumber: so.soNumber || d.soNumber || '',
          soStatus: so.status || '',
          soDate: so.requestedDate || '',
          poRef: so.galleyPoRef || d.clientPoRef || '',
          bastDate: b?.tanggalBast || '',
          client: d.deliverTo || '',
          vessel: d.vesselName || '',
          qty,
          hasBast: !!b,
          dppRate: iv.dppRate ?? '',
          oatRate: iv.oatRate ?? '',
          pbbkbRate: iv.pbbkbRate ?? '',
          priced,
          ...money,
        };
      });
  }, [doC.data, bastByDO, invById, soById]);

  // ---- Cargo type: PPS (default) vs MBSS. MBSS gets a different layout later. --
  const [cargo, setCargo] = useState('PPS');   // 'PPS' | 'MBSS'

  // Rows for the active cargo type only.
  const cargoRows = useMemo(() => rows.filter(r => r.cargo === cargo), [rows, cargo]);

  // ---- Filters: delivery (BAST) date range, company, vessel ----------------
  const [fFrom, setFFrom]     = useState('');
  const [fTo, setFTo]         = useState('');
  const [fClient, setFClient] = useState('');
  const [fVessel, setFVessel] = useState('');
  const [fStatus, setFStatus] = useState('');

  // Distinct dropdown options from the current cargo's delivered rows.
  const clientOpts = useMemo(
    () => [...new Set(cargoRows.map(r => r.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cargoRows]);
  const vesselOpts = useMemo(
    () => [...new Set(cargoRows.map(r => r.vessel).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cargoRows]);
  // SO-status options actually present in this cargo's rows, ordered by the
  // canonical lifecycle so the dropdown reads BAST done / requested / DO issued etc.
  const STATUS_ORDER = ['pending_approval', 'requested', 'do_issued', 'bast_done', 'reconciled', 'cancelled'];
  const statusOpts = useMemo(() => {
    const present = new Set(cargoRows.map(r => r.soStatus).filter(Boolean));
    return STATUS_ORDER.filter(st => present.has(st));
  }, [cargoRows]);

  const filtersActive = fFrom || fTo || fClient || fVessel || fStatus;
  const clearFilters = () => { setFFrom(''); setFTo(''); setFClient(''); setFVessel(''); setFStatus(''); };

  // Apply filters (by BAST date range + exact company/vessel/SO status) before sort/paginate.
  const filteredRows = useMemo(() => {
    return cargoRows.filter(r => {
      if (fFrom && (!r.bastDate || r.bastDate < fFrom)) return false;
      if (fTo   && (!r.bastDate || r.bastDate > fTo))   return false;
      if (fClient && r.client !== fClient) return false;
      if (fVessel && r.vessel !== fVessel) return false;
      if (fStatus && r.soStatus !== fStatus) return false;
      return true;
    });
  }, [cargoRows, fFrom, fTo, fClient, fVessel, fStatus]);

  // Sortable columns.
  const sortCols = useMemo(() => ({
    soNumber: r => r.soNumber || '',
    poRef:    r => r.poRef || '',
    soDate:   r => r.soDate || '',
    bastDate: r => r.bastDate || '',
    client:   r => r.client || '',
    vessel:   r => r.vessel || '',
    qty:      r => r.qty,
    subtotal: r => r.subtotal,
    priced:   r => (r.priced ? 1 : 0),
  }), []);

  // Default: unpriced first (so what needs attention surfaces), then BAST date desc.
  const baseRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      if (a.priced !== b.priced) return a.priced ? 1 : -1;
      return String(b.bastDate || '').localeCompare(String(a.bastDate || ''));
    });
  }, [filteredRows]);

  const { sorted, sortKey, sortDir, toggle } = useSort(baseRows, sortCols);
  const pg = usePagination(sorted, 20);

  // Selection helpers (operate over the full sorted set, not just the page).
  const selectableIds = sorted.filter(r => r.hasBast).map(r => r.id);
  const selectedIds = Object.keys(sel).filter(id => sel[id]);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => sel[id]);
  const toggleAll = () => {
    if (allSelected) setSel({});
    else setSel(Object.fromEntries(selectableIds.map(id => [id, true])));
  };
  const toggleOne = (id) => setSel(m => ({ ...m, [id]: !m[id] }));

  // Apply the entered rates to all selected DOs.
  const applyRates = async () => {
    if (!canWrite || busy) return;
    if (selectedIds.length === 0) { alert('Select at least one delivery order.'); return; }
    if (dppRate === '' && oatRate === '' && pbbkbRate === '') {
      alert('Enter at least one rate (DPP, OAT, or PBBKB) to apply.'); return;
    }
    if (!confirm(`Apply the entered rates to ${selectedIds.length} delivery order(s)?`)) return;
    setBusy(true);
    try {
      // Only write the rate fields that were actually entered; leave others as they were.
      const patch = { pricedBy: user?.email || '', pricedAt: new Date().toISOString() };
      if (dppRate   !== '') patch.dppRate   = Number(dppRate);
      if (oatRate   !== '') patch.oatRate   = Number(oatRate);
      if (pbbkbRate !== '') patch.pbbkbRate = Number(pbbkbRate);
      await Promise.all(selectedIds.map(id => invC.setWithId(id, patch)));
      setSel({});
    } catch (e) {
      alert('Error applying rates: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Grand totals across the FILTERED rows (so totals reflect the current view).
  const totals = useMemo(() => filteredRows.reduce((acc, r) => {
    acc.qty += r.qty; acc.dpp += r.dpp; acc.oat += r.oat;
    acc.ppn += r.ppn; acc.pbbkb += r.pbbkb; acc.subtotal += r.subtotal;
    return acc;
  }, { qty: 0, dpp: 0, oat: 0, ppn: 0, pbbkb: 0, subtotal: 0 }), [filteredRows]);

  const rateInput = (val, setter, placeholder) => (
    <input type="number" step="0.01" value={val} onChange={e => setter(e.target.value)}
      disabled={!canWrite} placeholder={placeholder}
      style={{ ...s.input, width: 120, fontSize: 11 }} />
  );

  return (
    <div style={{ padding: narrow ? 16 : 40, maxWidth: 1200 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>COMMERCIAL — PRICING CONTROL</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          Delivered DOs with their 15°C received quantity. Set DPP &amp; OAT (Rp/L) and PBBKB (% of DPP)
          across several at once. PPN is {PPN_PCT}% of DPP+OAT. Control/record only — invoices are issued elsewhere.
        </div>
      </div>

      {/* Cargo-type toggle: PPS cargo (default) vs MBSS cargo */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16,
        border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
        {[
          { key: 'PPS',  label: 'PPS CARGO' },
          { key: 'MBSS', label: 'MBSS CARGO' },
        ].map(opt => {
          const on = cargo === opt.key;
          return (
            <button key={opt.key}
              onClick={() => { setCargo(opt.key); clearFilters(); setSel({}); }}
              style={{
                background: on ? T.amber : 'transparent',
                color: on ? '#000' : T.textDim,
                border: 'none', padding: '8px 18px', cursor: 'pointer',
                fontSize: 11, fontWeight: on ? 700 : 400, letterSpacing: 1,
                fontFamily: T.font }}>
              {opt.label}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                ({rows.filter(r => r.cargo === opt.key).length})
              </span>
            </button>
          );
        })}
      </div>

      {cargo === 'MBSS' ? (
        // -------- MBSS cargo: layout TBD --------
        <div style={{ ...s.card, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: T.blue, letterSpacing: 1.5 }}>MBSS CARGO</div>
          <div style={{ fontSize: 13, color: T.text, marginTop: 8 }}>
            {cargoRows.length} delivered MBSS delivery order{cargoRows.length === 1 ? '' : 's'}.
          </div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 6 }}>
            MBSS cargo uses a different commercial layout — coming next. Switch back to{' '}
            <span onClick={() => setCargo('PPS')} style={{ color: T.amber, cursor: 'pointer', textDecoration: 'underline' }}>PPS cargo</span>{' '}
            for pricing control.
          </div>
        </div>
      ) : (
      <>
      {/* Filter bar */}
      <div style={{ ...s.card, marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
          FILTERS {filteredRows.length !== cargoRows.length && (
            <span style={{ color: T.amber }}>· {filteredRows.length} of {cargoRows.length} shown</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={s.label}>Delivery Date — From</label>
            <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)}
              style={{ ...s.input, width: 150, fontSize: 11 }} />
          </div>
          <div>
            <label style={s.label}>To</label>
            <input type="date" value={fTo} onChange={e => setFTo(e.target.value)}
              style={{ ...s.input, width: 150, fontSize: 11 }} />
          </div>
          <div>
            <label style={s.label}>Company</label>
            <select value={fClient} onChange={e => setFClient(e.target.value)}
              style={{ ...s.input, width: 200, fontSize: 11 }}>
              <option value="">— all —</option>
              {clientOpts.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Vessel</label>
            <select value={fVessel} onChange={e => setFVessel(e.target.value)}
              style={{ ...s.input, width: 170, fontSize: 11 }}>
              <option value="">— all —</option>
              {vesselOpts.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>SO Status</label>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}
              style={{ ...s.input, width: 160, fontSize: 11 }}>
              <option value="">— all —</option>
              {statusOpts.map(st => (
                <option key={st} value={st}>{SO_STATUS_LABELS[st] || st}</option>
              ))}
            </select>
          </div>
          {filtersActive && (
            <button onClick={clearFilters} style={{ ...s.btn('ghost'), fontSize: 11 }}>CLEAR FILTERS</button>
          )}
        </div>
      </div>

      {/* Set-rates bar */}
      <div style={{ ...s.card, marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>
          SET RATES FOR SELECTED ({selectedIds.length})
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={s.label}>DPP (Rp/L)</label>
            {rateInput(dppRate, setDppRate, 'e.g. 12000.00')}
          </div>
          <div>
            <label style={s.label}>OAT (Rp/L)</label>
            {rateInput(oatRate, setOatRate, 'e.g. 500.00')}
          </div>
          <div>
            <label style={s.label}>PBBKB (% of DPP)</label>
            {rateInput(pbbkbRate, setPbbkbRate, '0')}
          </div>
          <button onClick={applyRates} disabled={!canWrite || busy || selectedIds.length === 0}
            style={{ ...s.btn('primary'), opacity: (!canWrite || busy || selectedIds.length === 0) ? 0.5 : 1 }}>
            {busy ? 'APPLYING…' : 'APPLY TO SELECTED'}
          </button>
          <span style={{ fontSize: 10, color: T.textFaint }}>
            Only rates you fill are changed; blanks leave the DO's existing rate untouched.
          </span>
        </div>
      </div>

      {/* List */}
      {doC.loading || bastC.loading ? (
        <div style={{ color: T.textDim, fontSize: 12 }}>Loading…</div>
      ) : cargoRows.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>No delivered PPS-cargo delivery orders yet.</div>
      ) : filteredRows.length === 0 ? (
        <div style={{ color: T.textFaint, fontSize: 12, padding: 20 }}>
          No delivery orders match the current filters.{' '}
          <span onClick={clearFilters} style={{ color: T.amber, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</span>
        </div>
      ) : narrow ? (
        // -------- Mobile: stacked cards --------
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pg.pageRows.map(r => (
            <div key={r.id} style={{ ...s.card, padding: 14, opacity: r.hasBast ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={!!sel[r.id]} disabled={!r.hasBast || !canWrite}
                    onChange={() => toggleOne(r.id)} />
                  <span style={{ fontFamily: T.font, color: T.amber, fontSize: 11 }}>{r.soNumber || '—'}</span>
                </label>
                <span style={{ fontSize: 10, color: r.priced ? T.green : T.textFaint }}>
                  {r.priced ? 'priced' : 'not priced'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>
                PO {r.poRef || '—'} · SO {r.soDate || '—'}
              </div>
              <div style={{ fontSize: 13, color: T.text, marginTop: 4 }}>{r.client}</div>
              <div style={{ fontSize: 11, color: T.textDim, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <span>BAST {r.bastDate || '—'}</span>
                <span>· {r.vessel || '—'}</span>
                <span style={{ fontFamily: T.font }}>· {r.hasBast ? fmtL(r.qty) + ' L' : 'no BAST'}</span>
              </div>
              {r.priced && (
                <div style={{ fontSize: 11, color: T.textDim, marginTop: 6, lineHeight: 1.7 }}>
                  <div>DPP: <span style={{ fontFamily: T.font, color: T.text }}>{fmtRp(r.dpp)}</span></div>
                  <div>OAT: <span style={{ fontFamily: T.font, color: T.text }}>{fmtRp(r.oat)}</span></div>
                  <div>PPN: <span style={{ fontFamily: T.font, color: T.text }}>{fmtRp(r.ppn)}</span></div>
                  <div>PBBKB: <span style={{ fontFamily: T.font, color: T.text }}>{fmtRp(r.pbbkb)}</span></div>
                  <div style={{ marginTop: 2 }}>Subtotal: <span style={{ fontFamily: T.font, color: T.amber, fontWeight: 700 }}>{fmtRp(r.subtotal)}</span></div>
                </div>
              )}
            </div>
          ))}
          <PaginationBar {...pg} />
        </div>
      ) : (
        // -------- Desktop: table --------
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 28 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!canWrite} />
                  </th>
                  <SortHeader label="SO NUMBER" colKey="soNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="PO REF" colKey="poRef" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="SO DATE" colKey="soDate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="BAST DATE" colKey="bastDate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="CLIENT" colKey="client" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="VESSEL" colKey="vessel" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                  <SortHeader label="QTY 15°C (L)" colKey="qty" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                  <th style={{ ...s.th, textAlign: 'right' }}>DPP</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>OAT</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>PPN</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>PBBKB</th>
                  <SortHeader label="SUBTOTAL" colKey="subtotal" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                  <SortHeader label="PRICED" colKey="priced" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {pg.pageRows.map(r => (
                  <tr key={r.id} style={{ opacity: r.hasBast ? 1 : 0.55 }}>
                    <td style={{ ...s.td, width: 28 }}>
                      <input type="checkbox" checked={!!sel[r.id]} disabled={!r.hasBast || !canWrite}
                        onChange={() => toggleOne(r.id)} />
                    </td>
                    <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 10 }}>{r.soNumber || '—'}</td>
                    <td style={{ ...s.td, fontSize: 10 }}>{r.poRef || '—'}</td>
                    <td style={s.td}>{r.soDate || '—'}</td>
                    <td style={s.td}>{r.bastDate || '—'}</td>
                    <td style={s.td}>{r.client}</td>
                    <td style={s.td}>{r.vessel || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>
                      {r.hasBast ? fmtL(r.qty) : <span style={{ color: T.red, fontSize: 10 }}>no BAST</span>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{r.priced ? fmtRp(r.dpp) : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{r.priced ? fmtRp(r.oat) : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{r.priced ? fmtRp(r.ppn) : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{r.priced ? fmtRp(r.pbbkb) : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: T.amber, fontWeight: 700 }}>{r.priced ? fmtRp(r.subtotal) : '—'}</td>
                    <td style={s.td}>
                      <span style={{ fontSize: 10, color: r.priced ? T.green : T.textFaint }}>
                        {r.priced ? 'priced' : 'not priced'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.border}` }}>
                  <td style={s.td}></td>
                  <td style={{ ...s.td, fontSize: 10, color: T.textDim, letterSpacing: 1 }} colSpan={6}>GRAND TOTAL (filtered)</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(totals.qty)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{fmtRp(totals.dpp)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{fmtRp(totals.oat)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{fmtRp(totals.ppn)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, fontSize: 10 }}>{fmtRp(totals.pbbkb)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font, color: T.amber, fontWeight: 700 }}>{fmtRp(totals.subtotal)}</td>
                  <td style={s.td}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <PaginationBar {...pg} />
        </>
      )}
      </>
      )}
    </div>
  );
}
