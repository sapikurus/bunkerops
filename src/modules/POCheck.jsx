// POCheck.jsx — "completed but no final PO yet" check for the Commercial page.
//
// Flow with Daidan: PO request (PO number) → delivered (BAST done) → final PO
// approval released. The team logs every bunkering that has its FINAL PO in the
// shared Google Sheet (MASTER tab, "PO Reference" column). This panel compares
// that list with BunkerOps and shows the sales orders that are BAST-done but
// whose PO is not in the sheet yet.
//
// Default: the PO list is fetched straight from the sheet by the getFinalPOs
// Cloud Function (sheet stays private; only the PO column is returned).
// Fallback: load a CSV or paste the column — read locally, never uploaded.

import { useState, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { T, s } from '../tokens';
import { SCHEMES } from '../config';
import { functions } from '../firebase';
import { buildModel, downloadXlsx, downloadPdf } from './poCheckExport';

// Statuses that count as "bunkering completed".
const DONE = ['bast_done', 'reconciled'];

// Sales scheme of a Commercial row (rows carry cargo PPS / MBSS).
const rowScheme = (r) => (r.cargo === 'MBSS' ? 'NON_PPS_SALE' : 'PPS_SALE');

// Normalise a PO number so typing differences still match:
//   PO48-2610-0010, P048-2610-0010, po48-2610-10  → P48-2610-10
//   PO043-2609-0088, PO43-2609-0088              → P43-2609-88
// Anything not in the Daidan "PO<n>-<yymm>-<seq>" shape falls back to an
// upper-case, letters-and-digits-only comparison.
export function normPO(v) {
  const t = String(v ?? '').toUpperCase().replace(/\s+/g, '');
  if (!t) return '';
  const m = t.match(/^P[O0]?(\d+)-(\d+)-(\d+)$/);
  if (m) return `P${Number(m[1])}-${m[2]}-${Number(m[3])}`;
  return t.replace(/[^A-Z0-9]/g, '');
}

// Minimal CSV parser (quoted fields, embedded commas/newlines, "" escapes).
export function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Pull PO numbers out of a CSV export or pasted text.
// - CSV with a "PO Reference" header: that column only (every header row found,
//   so a multi-sheet export works too).
// - Anything else (e.g. a pasted column): every cell / line is a candidate.
export function extractPOs(text) {
  const out = new Set();
  const rows = parseCSV(String(text || ''));
  let col = -1, usedHeader = false;
  for (const r of rows) {
    // A multi-tab export marks each tab with "## Sheet name: …" — stop reading
    // the PO column there until the next "PO Reference" header appears.
    if (/^\s*##/.test(r[0] || '')) { col = -1; continue; }
    const hi = r.findIndex(c => /^\s*po\s*ref/i.test(c));
    if (hi >= 0) { col = hi; usedHeader = true; continue; }
    if (col >= 0) { const k = normPO(r[col]); if (k) out.add(k); }
  }
  if (!usedHeader) {
    for (const tok of String(text || '').split(/[\n\r\t,;]+/)) {
      const k = normPO(tok);
      if (k) out.add(k);
    }
  }
  return out;
}

const fmtL = (n) => (Number(n) || 0).toLocaleString('id-ID');

export default function POCheck({ rows, onClose }) {
  const [sheetPOs, setSheetPOs] = useState(null);   // Set of normalised POs, or null
  const [source, setSource]     = useState('');
  const [paste, setPaste]       = useState('');
  const [exporting, setExporting] = useState('');   // '' | 'xlsx' | 'pdf'
  const [fetching, setFetching] = useState(false);
  // Filters — same idea as Sales Requests: scheme (default PPS Sale) + client group.
  const [fScheme, setFScheme] = useState('PPS_SALE');
  const [fClient, setFClient] = useState('');
  const [fetchErr, setFetchErr] = useState('');
  const [showManual, setShowManual] = useState(false);

  const load = (text, label) => {
    const set = extractPOs(text);
    setSheetPOs(set);
    setSource(`${label} · ${set.size} PO number${set.size === 1 ? '' : 's'} found`);
    setFetchErr('');
  };

  // Fetch the PO column straight from the shared sheet (no download needed).
  const fetchFromSheet = async () => {
    setFetching(true); setFetchErr('');
    try {
      const res = await httpsCallable(functions, 'getFinalPOs')();
      const set = new Set((res.data?.pos || []).map(normPO).filter(Boolean));
      setSheetPOs(set);
      const at = res.data?.fetchedAt ? new Date(res.data.fetchedAt).toLocaleString('id-ID') : '';
      setSource(`Live from shared sheet (${res.data?.tab || 'MASTER'}) · ${set.size} PO numbers · ${at}`);
    } catch (e) {
      // Callable errors carry a readable message from the function.
      setFetchErr(e?.message || String(e));
      setShowManual(true);   // offer CSV / paste as a fallback
    } finally {
      setFetching(false);
    }
  };

  // Client-group choices (from the sales orders in the chosen scheme).
  const clientOpts = useMemo(() => [...new Set(rows
      .filter(r => !fScheme || rowScheme(r) === fScheme)
      .map(r => r.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows, fScheme]);

  // Rows in scope for the chosen scheme + client group.
  const scopedRows = useMemo(() => rows.filter(r =>
    (!fScheme || rowScheme(r) === fScheme) && (!fClient || r.client === fClient)),
  [rows, fScheme, fClient]);

  const schemeLabel = fScheme ? (SCHEMES[fScheme]?.label || fScheme) : 'All schemes';
  const clientLabel = fClient || 'All client groups';

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    load(await f.text(), f.name);
  };

  // Completed SOs, split into: has final PO / missing final PO / no PO in BunkerOps.
  const result = useMemo(() => {
    if (!sheetPOs) return null;
    const done = scopedRows.filter(r => DONE.includes(r.soStatus));
    const matched = [], missing = [], noRef = [];
    for (const r of done) {
      const k = normPO(r.poRef);
      if (!k) noRef.push(r);
      else if (sheetPOs.has(k)) matched.push(r);
      else missing.push(r);
    }
    // Oldest delivery first — those have waited longest for the final PO.
    const byDate = (a, b) => String(a.bastDate || '').localeCompare(String(b.bastDate || ''));
    missing.sort(byDate); noRef.sort(byDate);
    return { done: done.length, matched: matched.length, missing, noRef };
  }, [scopedRows, sheetPOs]);

  // Download the result as Excel or PDF (libraries load on first click).
  const download = async (kind) => {
    if (!result || exporting) return;
    setExporting(kind);
    try {
      const model = buildModel(result, { schemeLabel, clientLabel, source });
      if (kind === 'xlsx') await downloadXlsx(model); else await downloadPdf(model);
    } catch (e) {
      alert('Could not create the file: ' + (e?.message || e));
    } finally {
      setExporting('');
    }
  };

  const table = (list, title, accent) => list.length === 0 ? null : (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, color: accent, letterSpacing: 1.5, marginBottom: 6 }}>{title} ({list.length})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead><tr>
            {['SO NUMBER', 'PO REF', 'CLIENT', 'VESSEL', 'BAST', 'BAST DATE'].map(h => <th key={h} style={s.th}>{h}</th>)}
            <th style={{ ...s.th, textAlign: 'right' }}>QTY (L)</th>
          </tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id}>
                <td style={{ ...s.td, fontFamily: T.font, color: T.amber, fontSize: 10 }}>{r.soNumber || '—'}</td>
                <td style={{ ...s.td, fontFamily: T.font, fontSize: 11 }}>{r.poRef || '—'}</td>
                <td style={s.td}>{r.client}{r.entity && <div style={{ fontSize: 10, color: T.textDim }}>{r.entity}</div>}</td>
                <td style={s.td}>{r.vessel || '—'}</td>
                <td style={{ ...s.td, fontFamily: T.font, fontSize: 10 }}>{r.bastNo || '—'}</td>
                <td style={s.td}>{r.bastDate || '—'}</td>
                <td style={{ ...s.td, textAlign: 'right', fontFamily: T.font }}>{fmtL(r.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={{ ...s.card, marginBottom: 20, borderTop: `2px solid ${T.amber}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>PO CHECK — COMPLETED, NO FINAL PO YET</div>
        <button onClick={onClose} style={{ ...s.btn('ghost'), padding: '2px 10px', fontSize: 10 }}>CLOSE</button>
      </div>
      <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.6, marginBottom: 12 }}>
        Choose the scheme and client group, then CHECK. Completed sales orders are compared with the
        final-PO list in the shared sheet (MASTER tab), read straight from the sheet.
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <label style={s.label}>Scheme</label>
          <select value={fScheme} onChange={e => { setFScheme(e.target.value); setFClient(''); }}
            style={{ ...s.input, width: 240, fontSize: 11 }}>
            {Object.values(SCHEMES).map(sc => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
            <option value="">All schemes</option>
          </select>
        </div>
        <div>
          <label style={s.label}>Client Group</label>
          <select value={fClient} onChange={e => setFClient(e.target.value)}
            style={{ ...s.input, width: 220, fontSize: 11 }}>
            <option value="">All client groups</option>
            {clientOpts.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={fetchFromSheet} disabled={fetching}
          style={{ ...s.btn('primary'), fontSize: 11, opacity: fetching ? 0.6 : 1 }}>
          {fetching ? 'READING SHEET…' : (sheetPOs ? '⟳ RE-CHECK (refresh sheet)' : '🔎 CHECK')}
        </button>
        <span onClick={() => setShowManual(v => !v)}
          style={{ fontSize: 10, color: T.textDim, cursor: 'pointer', textDecoration: 'underline' }}>
          {showManual ? 'hide other ways to load' : 'other ways to load (CSV / paste)'}
        </span>
      </div>
      {fetchErr && (
        <div style={{ fontSize: 11, color: T.red, marginTop: 10, lineHeight: 1.5 }}>
          Couldn't read the sheet: {fetchErr}
        </div>
      )}

      {showManual && (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 12 }}>
        <label style={{ ...s.btn('primary'), fontSize: 11, cursor: 'pointer' }}>
          LOAD CSV
          <input type="file" accept=".csv,text/csv,.txt,text/plain" onChange={onFile} style={{ display: 'none' }} />
        </label>
        <div style={{ flex: 1, minWidth: 220 }}>
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3}
            placeholder="…or paste PO numbers here (one per line)"
            style={{ ...s.input, width: '100%', fontSize: 11, fontFamily: T.font, resize: 'vertical' }} />
          <button onClick={() => load(paste, 'Pasted list')} disabled={!paste.trim()}
            style={{ ...s.btn('ghost'), fontSize: 10, marginTop: 6, opacity: paste.trim() ? 1 : 0.5 }}>
            CHECK PASTED LIST
          </button>
        </div>
      </div>
      )}

      {result && (
        <>
          <div style={{ fontSize: 11, color: T.text, marginTop: 14 }}>
            <b>{schemeLabel}</b> · <b>{clientLabel}</b>
          </div>
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>{source}</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
            <span>Completed SOs: <b>{result.done}</b></span>
            <span style={{ color: T.green }}>Final PO in sheet: <b>{result.matched}</b></span>
            <span style={{ color: result.missing.length ? T.red : T.textDim }}>Missing final PO: <b>{result.missing.length}</b></span>
            {result.noRef.length > 0 && <span style={{ color: T.amber }}>No PO in BunkerOps: <b>{result.noRef.length}</b></span>}
          </div>
          {result.missing.length === 0 && result.noRef.length === 0 ? (
            <div style={{ fontSize: 12, color: T.green, marginTop: 12 }}>✓ Every completed sales order has its final PO in the sheet.</div>
          ) : (
            <>
              {table(result.missing, 'COMPLETED — FINAL PO NOT IN SHEET', T.red)}
              {table(result.noRef, 'COMPLETED — NO PO REFERENCE IN BUNKEROPS', T.amber)}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={() => download('xlsx')} disabled={!!exporting}
              style={{ ...s.btn('ghost'), fontSize: 11, color: T.green, borderColor: T.green, opacity: exporting ? 0.6 : 1 }}>
              {exporting === 'xlsx' ? 'CREATING…' : '⬇ EXCEL'}
            </button>
            <button onClick={() => download('pdf')} disabled={!!exporting}
              style={{ ...s.btn('ghost'), fontSize: 11, color: T.red, borderColor: T.red, opacity: exporting ? 0.6 : 1 }}>
              {exporting === 'pdf' ? 'CREATING…' : '⬇ PDF'}
            </button>
          </div>
          {sheetPOs.size === 0 && (
            <div style={{ fontSize: 11, color: T.red, marginTop: 10 }}>
              No PO numbers were found in that file — check it is the MASTER tab with a "PO Reference" column.
            </div>
          )}
        </>
      )}
    </div>
  );
}
