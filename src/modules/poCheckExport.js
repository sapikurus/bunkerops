// poCheckExport.js — download the PO CHECK result as Excel (.xlsx) or PDF.
//
// The report is built once (buildModel) and rendered two ways, so the Excel and
// the PDF always carry the same rows and totals. The file libraries load only
// when a download is clicked (dynamic import), so they don't slow the app.
//
// Requires: npm install write-excel-file jspdf jspdf-autotable

const COLS = [
  { key: 'no',       label: 'No',           w: 5,  pdf: 8,  num: true },
  { key: 'soNumber', label: 'SO Number',    w: 24, pdf: 40 },
  { key: 'poRef',    label: 'PO Reference', w: 20, pdf: 32 },
  { key: 'client',   label: 'Client Group', w: 18, pdf: 28 },
  { key: 'entity',   label: 'Entity',       w: 30, pdf: 'auto' },   // takes the remaining width
  { key: 'vessel',   label: 'Vessel',       w: 16, pdf: 24 },
  { key: 'bastNo',   label: 'BAST No',      w: 20, pdf: 32 },
  { key: 'bastDate', label: 'BAST Date',    w: 12, pdf: 22 },
  { key: 'qty',      label: 'Qty (L)',      w: 12, pdf: 22, num: true },
];

const fmtQty = (n) => (Number(n) || 0).toLocaleString('id-ID');
const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Build the report model.
 * @param {object} result  { done, matched, missing:[], noRef:[] } from POCheck
 * @param {object} meta    { schemeLabel, clientLabel, source }
 */
export function buildModel(result, meta) {
  const now = new Date();
  const toRow = (r, i) => ({
    no: i + 1, soNumber: r.soNumber || '', poRef: r.poRef || '-', client: r.client || '',
    entity: r.entity || '', vessel: r.vessel || '', bastNo: r.bastNo || '', bastDate: r.bastDate || '',
    qty: Number(r.qty) || 0,
  });
  const section = (title, list) => ({
    title, rows: list.map(toRow), totalQty: list.reduce((a, r) => a + (Number(r.qty) || 0), 0),
  });
  const sections = [
    section('Completed — final PO not in sheet', result.missing),
    section('Completed — no PO reference in BunkerOps', result.noRef),
  ].filter(s => s.rows.length > 0);
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    title: 'PO CHECK — Completed bunkerings without final PO',
    filters: [['Scheme', meta.schemeLabel], ['Client group', meta.clientLabel]],
    generatedAt: now.toLocaleString('id-ID'),
    source: meta.source || '',
    counts: [
      ['Completed SOs', result.done],
      ['Final PO in sheet', result.matched],
      ['Missing final PO', result.missing.length],
      ['No PO in BunkerOps', result.noRef.length],
    ],
    sections,
    fileBase: ['PO-Check', slug(meta.schemeLabel.split('(')[0]), slug(meta.clientLabel), ymd].filter(Boolean).join('_'),
  };
}

// ---- Excel -----------------------------------------------------------------
// writeXlsxFile is passed in so the same code runs in the browser and in tests.
export function buildXlsx(model, writeXlsxFile) {
  const B = (value) => ({ value, fontWeight: 'bold' });
  const data = [];
  data.push([{ value: model.title, fontWeight: 'bold', fontSize: 14 }]);
  for (const [k, v] of model.filters) data.push([B(k), { value: v }]);
  data.push([B('Generated'), { value: model.generatedAt }]);
  if (model.source) data.push([B('PO source'), { value: model.source }]);
  data.push([null]);
  for (const [k, v] of model.counts) data.push([B(k), { value: v, type: Number }]);

  if (model.sections.length === 0) {
    data.push([null]);
    data.push([{ value: 'Every completed sales order has its final PO in the sheet.' }]);
  }
  for (const sec of model.sections) {
    data.push([null]);
    data.push([{ value: `${sec.title} (${sec.rows.length})`, fontWeight: 'bold' }]);
    data.push(COLS.map(c => ({ value: c.label, fontWeight: 'bold', backgroundColor: '#EEEEEE', borderStyle: 'thin' })));
    for (const r of sec.rows) {
      data.push(COLS.map(c => c.num
        ? { value: r[c.key], type: Number, format: c.key === 'qty' ? '#,##0' : '0', borderStyle: 'thin' }
        : { value: String(r[c.key] ?? ''), type: String, borderStyle: 'thin' }));
    }
    data.push(COLS.map((c, i) =>
      i === COLS.length - 2 ? { value: 'TOTAL', fontWeight: 'bold', align: 'right' }
      : i === COLS.length - 1 ? { value: sec.totalQty, type: Number, format: '#,##0', fontWeight: 'bold' }
      : null));
  }
  return writeXlsxFile(data, { sheet: 'PO Check', columns: COLS.map(c => ({ width: c.w })) });
}

export async function downloadXlsx(model) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await buildXlsx(model, writeXlsxFile).toFile(`${model.fileBase}.xlsx`);
}

// ---- PDF -------------------------------------------------------------------
export function buildPdf(model, jsPDF, autoTable) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const L = 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(model.title, L, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  let y = 23;
  const meta = [...model.filters, ['Generated', model.generatedAt]];
  if (model.source) meta.push(['PO source', model.source]);
  for (const [k, v] of meta) { doc.text(`${k}: ${v}`, L, y); y += 4.6; }
  y += 1.5;
  doc.setFont('helvetica', 'bold');
  doc.text(model.counts.map(([k, v]) => `${k}: ${v}`).join('     ·     '), L, y);
  y += 6;

  if (model.sections.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('Every completed sales order has its final PO in the sheet.', L, y + 4);
  }
  for (const sec of model.sections) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`${sec.title} (${sec.rows.length})`, L, y + 4);
    autoTable(doc, {
      startY: y + 6,
      margin: { left: L, right: L },
      tableWidth: 'auto',
      head: [COLS.map(c => c.label)],
      body: sec.rows.map(r => COLS.map(c => c.key === 'qty' ? fmtQty(r.qty) : String(r[c.key] ?? ''))),
      foot: [COLS.map((c, i) => ({
        content: i === COLS.length - 2 ? 'TOTAL' : i === COLS.length - 1 ? fmtQty(sec.totalQty) : '',
        styles: { halign: i >= COLS.length - 2 ? 'right' : 'left' },
      }))],
      styles: { fontSize: 8, cellPadding: 1.6, lineColor: [190, 190, 190], lineWidth: 0.1 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
      footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(COLS.map((c, i) => [i, {
        cellWidth: c.pdf, halign: c.num ? 'right' : 'left',
      }])),
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 6;
  }
  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.text(`Page ${p} of ${pages}`, w - L, h - 7, { align: 'right' });
  }
  return doc;
}

export async function downloadPdf(model) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  buildPdf(model, jsPDF, autoTable).save(`${model.fileBase}.pdf`);
}
