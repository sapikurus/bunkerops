import { useState, useMemo } from 'react';
import { T, s } from '../tokens';
import {
  RECON_COLUMNS, RECON_DEFAULT_COLS, RECON_DEFAULT_PRICE_COLS, RECON_SCOPES,
  reconRowsFor, buildReconModel, downloadReconXlsx, downloadReconPdf,
} from './reconExport';

// Reconciliation report options: which bunkerings, which columns, prices on/off,
// then download as PDF or Excel. Uses the rows already narrowed by the
// Commercial filters (date, company, vessel, status), so the report can be
// scoped to one buyer and one period. Choices are remembered on this browser.

const STORE_KEY = 'bunkerops.recon.options';
const loadOpts = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
};
const saveOpts = (o) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* ignore */ } };

export default function ReconReport({ rows, clientLabel, period, statusLabel, onClose }) {
  const saved = loadOpts() || {};
  const [scope, setScope]   = useState(RECON_SCOPES[saved.scope] ? saved.scope : 'unpriced');
  const [cols, setCols]     = useState(Array.isArray(saved.cols) ? saved.cols : [...RECON_DEFAULT_COLS, ...RECON_DEFAULT_PRICE_COLS]);
  const [prices, setPrices] = useState(!!saved.prices);
  const [sigs, setSigs]     = useState(saved.signatures !== false);
  const [busy, setBusy]     = useState('');
  const [err, setErr]       = useState('');

  const picked = useMemo(() => reconRowsFor(rows, scope), [rows, scope]);
  const pricedCount = picked.filter(r => r.priced).length;
  const toggleCol = (k) => setCols(c => (c.includes(k) ? c.filter(x => x !== k) : [...c, k]));
  const shownCols = RECON_COLUMNS.filter(c => cols.includes(c.key) && (prices || !c.price));

  const download = async (kind) => {
    if (picked.length === 0) { setErr('No bunkerings match this choice and the current filters.'); return; }
    if (shownCols.length === 0) { setErr('Tick at least one column.'); return; }
    setErr(''); setBusy(kind);
    saveOpts({ scope, cols, prices, signatures: sigs });
    try {
      const model = buildReconModel(picked, { scope, cols, prices, signatures: sigs, clientLabel, period, statusLabel });
      if (kind === 'pdf') await downloadReconPdf(model);
      else await downloadReconXlsx(model);
    } catch (e) {
      setErr('Could not create the file: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  const box = (on, label, onChange, disabled) => (
    <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
      color: disabled ? T.textFaint : T.text, cursor: disabled ? 'default' : 'pointer', minWidth: 130 }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );

  return (
    <div style={{ ...s.card, marginBottom: 20, borderColor: T.amber }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>🧾 RECONCILIATION REPORT</div>
        <span onClick={onClose} style={{ color: T.textDim, cursor: 'pointer', fontSize: 12 }}>✕</span>
      </div>
      <div style={{ fontSize: 11, color: T.textDim, marginBottom: 14, lineHeight: 1.6 }}>
        For matching BunkerOps with the buyer. Uses the filters below (company, vessel, delivery dates, status) —
        currently <b style={{ color: T.text }}>{clientLabel}</b>, {period}.
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <label style={s.label}>Include</label>
          <select value={scope} onChange={e => setScope(e.target.value)} style={{ ...s.input, width: 280, fontSize: 11 }}>
            {Object.entries(RECON_SCOPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: T.textDim, paddingBottom: 8 }}>
          <b style={{ color: T.text }}>{picked.length}</b> line{picked.length === 1 ? '' : 's'}
          {scope !== 'unpriced' && <> · {pricedCount} priced</>}
        </div>
      </div>

      <div style={{ fontSize: 10, color: T.textDim, letterSpacing: 1.2, marginBottom: 6 }}>COLUMNS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 12 }}>
        {RECON_COLUMNS.filter(c => !c.price).map(c => box(cols.includes(c.key), c.label, () => toggleCol(c.key)))}
      </div>

      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginBottom: 12 }}>
        {box(prices, 'Include prices', () => setPrices(p => !p))}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8, paddingLeft: 20 }}>
          {RECON_COLUMNS.filter(c => c.price).map(c => box(cols.includes(c.key), c.label, () => toggleCol(c.key), !prices))}
        </div>
        {!prices && (
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6, paddingLeft: 20 }}>
            Prices off: no rate or amount appears in the file, even for priced bunkerings.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>{box(sigs, 'Signature lines (Prepared by PPS / Acknowledged by client)', () => setSigs(v => !v))}</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => download('pdf')} disabled={!!busy} style={{ ...s.btn('primary'), opacity: busy ? 0.6 : 1 }}>
          {busy === 'pdf' ? 'CREATING…' : '⬇ PDF'}
        </button>
        <button onClick={() => download('xlsx')} disabled={!!busy} style={{ ...s.btn('ghost'), opacity: busy ? 0.6 : 1 }}>
          {busy === 'xlsx' ? 'CREATING…' : '⬇ EXCEL'}
        </button>
        {err && <span style={{ fontSize: 11, color: T.red }}>{err}</span>}
      </div>
    </div>
  );
}
