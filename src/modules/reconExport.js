// reconExport.js — the Commercial reconciliation report as Excel (.xlsx) or PDF.
//
// One model (buildReconModel) feeds both outputs, so Excel and PDF always carry
// the same rows, columns and totals. Columns are chosen by the user; price
// columns appear only when "include prices" is on. File libraries load only
// when a download is clicked.

// Every column the report can show. `price: true` columns are hidden unless
// prices are included. `sum: true` columns get a total.
export const RECON_COLUMNS = [
  { key: 'soNumber', label: 'SO Number',     w: 24, pdf: 36 },
  { key: 'poRef',    label: 'Client PO Ref', w: 20, pdf: 30 },
  { key: 'soDate',   label: 'SO Date',       w: 12, pdf: 20 },
  { key: 'brNo',     label: 'DO Number',     w: 24, pdf: 36 },
  { key: 'bastNo',   label: 'BAST Number',   w: 20, pdf: 30 },
  { key: 'bastDate', label: 'BAST Date',     w: 12, pdf: 20 },
  { key: 'client',   label: 'Client Group',  w: 18, pdf: 26 },
  { key: 'entity',   label: 'Entity',        w: 30, pdf: 'auto' },
  { key: 'vessel',   label: 'Vessel',        w: 16, pdf: 24 },
  { key: 'status',   label: 'Status',        w: 13, pdf: 20 },
  { key: 'qty',      label: 'Qty (L)',       w: 12, pdf: 20, num: true, sum: true, fmt: 'qty' },
  { key: 'dppRate',  label: 'DPP (Rp/L)',    w: 13, pdf: 20, num: true, price: true, fmt: 'rate' },
  { key: 'oatRate',  label: 'OAT (Rp/L)',    w: 13, pdf: 20, num: true, price: true, fmt: 'rate' },
  { key: 'dpp',      label: 'DPP (Rp)',      w: 17, pdf: 26, num: true, price: true, sum: true, fmt: 'rp' },
  { key: 'oat',      label: 'OAT (Rp)',      w: 16, pdf: 24, num: true, price: true, sum: true, fmt: 'rp' },
  { key: 'ppn',      label: 'PPN (Rp)',      w: 16, pdf: 24, num: true, price: true, sum: true, fmt: 'rp' },
  { key: 'pbbkb',    label: 'PBBKB (Rp)',    w: 15, pdf: 22, num: true, price: true, sum: true, fmt: 'rp' },
  { key: 'subtotal', label: 'Total (Rp)',    w: 18, pdf: 28, num: true, price: true, sum: true, fmt: 'rp' },
];

// The old report's columns — the default selection.
export const RECON_DEFAULT_COLS = ['brNo', 'bastNo', 'poRef', 'vessel', 'qty', 'bastDate'];
export const RECON_DEFAULT_PRICE_COLS = ['dppRate', 'oatRate', 'subtotal'];

export const RECON_SCOPES = {
  unpriced:  { label: 'Delivered, not yet priced',          sub: 'Delivered bunkerings pending invoicing' },
  delivered: { label: 'All delivered (priced and not)',     sub: 'All delivered bunkerings' },
  all:       { label: 'All sales orders (incl. undelivered)', sub: 'All sales orders, delivered and open' },
};

const fmtQty  = (n) => (Number(n) || 0).toLocaleString('id-ID');
const fmtMoney = (n) => (Number(n) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Which rows a scope takes from the (already filtered) Commercial rows.
export function reconRowsFor(rows, scope) {
  if (scope === 'all') return rows;
  if (scope === 'delivered') return rows.filter(r => r.hasBast);
  return rows.filter(r => r.hasBast && !r.priced);
}

/**
 * Build the report model.
 * @param {object[]} rows  Commercial rows (from Invoicing.jsx)
 * @param {object} o  { scope, cols:[keys], prices:boolean, signatures:boolean,
 *                      clientLabel, period, statusLabel(st) }
 */
export function buildReconModel(rows, o) {
  const now = new Date();
  const cols = RECON_COLUMNS.filter(c => o.cols.includes(c.key) && (o.prices || !c.price));
  const sorted = [...rows].sort((a, b) =>
    String(a.bastDate || '9999').localeCompare(String(b.bastDate || '9999')) ||
    String(a.soDate || '').localeCompare(String(b.soDate || '')) ||
    String(a.soNumber || '').localeCompare(String(b.soNumber || '')));
  const out = sorted.map((r, i) => {
    const row = { no: i + 1 };
    for (const c of cols) {
      if (c.key === 'status') row.status = o.statusLabel ? o.statusLabel(r.soStatus) : r.soStatus;
      else if (c.key === 'qty') row.qty = r.hasBast ? Number(r.qty) || 0 : null;           // no BAST → blank
      else if (c.price) row[c.key] = r.priced ? round2(r[c.key]) : null;              // not priced → blank
      else row[c.key] = r[c.key] || '';
    }
    return row;
  });
  const totals = {};
  for (const c of cols) if (c.sum) totals[c.key] = round2(out.reduce((a, r) => a + (Number(r[c.key]) || 0), 0));
  const unpriced = o.prices ? sorted.filter(r => r.hasBast && !r.priced).length : 0;
  const scope = RECON_SCOPES[o.scope] || RECON_SCOPES.unpriced;
  const notes = ['Quantities are the observed liters received per the signed BAST.'];
  if (o.scope === 'all') notes.push('Sales orders without a BAST yet show no quantity.');
  if (o.prices) notes.push(`Amounts include PPN; PBBKB as recorded.${unpriced ? ` ${unpriced} delivered bunkering(s) not yet priced show no amount.` : ''}`);
  else notes.push('Issued for quantity reconciliation only.');
  return {
    title: 'BUNKER DELIVERY RECONCILIATION',
    subtitle: `${scope.sub} — for reconciliation between PT Petroprima Sejahtera and the buyer.`,
    meta: [['Client', o.clientLabel], ['Period (BAST date)', o.period], ['Lines', String(out.length)], ['Generated', now.toLocaleString('id-ID')]],
    cols, rows: out, totals, notes, signatures: !!o.signatures,
    fileBase: ['Reconciliation', slug(o.clientLabel), ymdOf(now)].filter(Boolean).join('_'),
  };
}

const cellText = (c, v) => (v == null || v === '' ? (c.num ? '-' : '') :
  c.fmt === 'qty' ? fmtQty(v) : c.num ? fmtMoney(v) : String(v));

// ---- Excel -----------------------------------------------------------------
export function buildReconXlsx(m, writeXlsxFile) {
  const B = (value) => ({ value, fontWeight: 'bold' });
  const head = [{ key: 'no', label: 'No', w: 5, num: true }, ...m.cols];
  const data = [];
  data.push([{ value: m.title, fontWeight: 'bold', fontSize: 14 }]);
  data.push([{ value: m.subtitle }]);
  for (const [k, v] of m.meta) data.push([B(k), { value: v }]);
  data.push([null]);
  data.push(head.map(c => ({ value: c.label, fontWeight: 'bold', backgroundColor: '#EEEEEE', borderStyle: 'thin',
    align: c.num ? 'right' : 'left' })));
  for (const r of m.rows) {
    data.push(head.map(c => {
      const v = r[c.key];
      if (c.num && v != null) return { value: v, type: Number, borderStyle: 'thin',
        format: c.key === 'no' ? '0' : c.fmt === 'qty' ? '#,##0' : '#,##0.00' };
      return { value: v == null ? '' : String(v), type: String, borderStyle: 'thin', align: c.num ? 'right' : 'left' };
    }));
  }
  const firstSum = head.findIndex(c => c.sum);
  data.push(head.map((c, i) => c.sum
    ? { value: m.totals[c.key], type: Number, format: c.fmt === 'qty' ? '#,##0' : '#,##0.00', fontWeight: 'bold', borderStyle: 'thin' }
    : i === Math.max(0, firstSum - 1) ? { value: 'TOTAL', fontWeight: 'bold', align: 'right' } : null));
  data.push([null]);
  for (const n of m.notes) data.push([{ value: n, fontSize: 9 }]);
  if (m.signatures) {
    data.push([null]); data.push([null]); data.push([null]);
    data.push([B('Prepared by (PPS)'), null, null, B('Acknowledged by (Client)')]);
  }
  return writeXlsxFile(data, { sheet: 'Reconciliation', columns: head.map(c => ({ width: c.w })) });
}

export async function downloadReconXlsx(m) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await buildReconXlsx(m, writeXlsxFile).toFile(`${m.fileBase}.xlsx`);
}

// ---- PDF -------------------------------------------------------------------
export function buildReconPdf(m, jsPDF, autoTable) {
  // Paper grows with the column count: A4 portrait → A4 landscape → A3 landscape.
  const n = m.cols.length;
  const landscape = n > 7 || m.cols.some(c => c.price);
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: n > 12 ? 'a3' : 'a4' });
  const L = 12;
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(m.title, L, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(m.subtitle, L, 22);
  let y = 28;
  for (let i = 0; i < m.meta.length; i += 2) {
    const [a, b] = [m.meta[i], m.meta[i + 1]];
    doc.text(`${a[0]}: ${a[1]}`, L, y);
    if (b) doc.text(`${b[0]}: ${b[1]}`, W / 2, y);
    y += 4.8;
  }
  const head = [{ key: 'no', label: 'No', num: true, pdf: 9 }, ...m.cols];
  // Shrink fixed widths proportionally when they don't fit the page.
  const avail = W - 2 * L;
  const fixed = head.reduce((a, c) => a + (typeof c.pdf === 'number' ? c.pdf : 0), 0);
  const hasAuto = head.some(c => c.pdf === 'auto');
  const scale = fixed + (hasAuto ? 30 : 0) > avail ? avail / (fixed + (hasAuto ? 30 : 0)) : 1;
  const firstSum = head.findIndex(c => c.sum);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: L, right: L },
    head: [head.map(c => c.label)],
    body: m.rows.map(r => head.map(c => c.key === 'no' ? String(r.no) : cellText(c, r[c.key]))),
    foot: [head.map((c, i) => ({
      content: c.sum ? cellText(c, m.totals[c.key]) : i === Math.max(0, firstSum - 1) ? 'TOTAL' : '',
      styles: { halign: c.num || i === firstSum - 1 ? 'right' : 'left' },
    }))],
    styles: { fontSize: head.length > 11 ? 7 : 8, cellPadding: 1.5, lineColor: [190, 190, 190], lineWidth: 0.1 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(head.map((c, i) => [i, {
      cellWidth: typeof c.pdf === 'number' ? c.pdf * scale : 'auto', halign: c.num ? 'right' : 'left',
    }])),
    theme: 'grid',
  });
  y = doc.lastAutoTable.finalY + 6;
  const H = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  const noteLines = doc.splitTextToSize(m.notes.join(' '), avail);
  if (y + noteLines.length * 4 + (m.signatures ? 34 : 0) > H - 12) { doc.addPage(); y = 18; }
  doc.text(noteLines, L, y);
  y += noteLines.length * 4;
  if (m.signatures) {
    const lineY = y + 26, w = avail * 0.4;
    doc.setDrawColor(60);
    doc.line(L, lineY, L + w, lineY);
    doc.line(W - L - w, lineY, W - L, lineY);
    doc.text('Prepared by (PPS)', L + w / 2, lineY + 4, { align: 'center' });
    doc.text('Acknowledged by (Client)', W - L - w / 2, lineY + 4, { align: 'center' });
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Page ${p} of ${pages}`, W - L, H - 7, { align: 'right' });
  }
  return doc;
}

export async function downloadReconPdf(m) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  buildReconPdf(m, jsPDF, autoTable).save(`${m.fileBase}.pdf`);
}
