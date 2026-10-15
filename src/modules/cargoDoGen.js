// cargoDoGen.js — printable Permit DO / SPP (Surat Pengantar Pengiriman) for the
// port-authority bunker permit on incoming cargo.
//
// Layout follows the client's BR form: letterhead + logo, number/date box,
// Delivery To / Vessel Name / Delivery Location boxes, a one-line item table,
// estimated delivery, note, and four signature columns. Issued under PPS.

// PPS letterhead — each address string prints on its own line (shown uppercase).
export const PPS_LETTERHEAD = {
  name: 'PT. PETROPRIMA SEJAHTERA',
  addressLines: [
    'Jl. P Antasari 66B, Kel. Teluk Lerong Ulu',
    'Sungai Kunjang, Samarinda, Kalimantan Timur',
  ],
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 'YYYY-MM-DD' → '03-Oct-2026'. Parsed by parts so the timezone can't shift the day.
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso ? esc(iso) : '-';
  return `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}`;
}

// Quantity with comma thousands, as on the BR form: 34053 → '34,053'.
const fmtQty = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * Build the Permit DO HTML.
 * @param {object} p
 *   sppNo, sppDate (YYYY-MM-DD), deliveryTo, supplyVessel, portDestination,
 *   product, quantityL, estDeliveryDate (YYYY-MM-DD), estDeliveryTime (HH:MM),
 *   note, issuerLogo (data URL / URL)
 */
export function buildCargoDOHtml(p) {
  const lh = PPS_LETTERHEAD;
  const est = fmtDate(p.estDeliveryDate) + (p.estDeliveryTime ? ` ${esc(p.estDeliveryTime)}` : '');
  const box = (label, value) => `
    <table class="box">
      <tr><th>${label}</th></tr>
      <tr><td class="val">${esc(value) || '&nbsp;'}</td></tr>
    </table>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(p.sppNo || 'Permit DO')}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 13px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .co { flex: 1; }
  .co h1 { font-size: 23px; margin: 4px 0 14px; letter-spacing: .3px; white-space: nowrap; }
  .co .addr { font-size: 12.5px; line-height: 1.75; text-transform: uppercase; }
  .right { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; }
  .right img { max-height: 64px; max-width: 240px; margin-bottom: 16px; }
  table { border-collapse: collapse; }
  .num { width: 260px; }
  .num td { border: 1.5px solid #000; padding: 7px 8px; font-size: 13px; white-space: nowrap; }
  .num td:first-child { width: 1%; }
  .boxes { display: flex; justify-content: space-between; gap: 32px; margin-top: 52px; }
  .col { width: 46%; }
  .box { width: 100%; border: 1.5px solid #000; }
  .box + .box { border-top: none; }
  .box th { text-align: left; font-size: 14px; padding: 8px 8px; border-bottom: 1.5px solid #000; }
  .box td.val { padding: 8px 8px 30px; font-size: 13.5px; text-transform: uppercase; }
  .items { width: 100%; margin-top: 30px; }
  .items th, .items td { border: 1.5px solid #000; padding: 8px 10px; }
  .items th { font-size: 15px; text-align: center; }
  .items td.c { text-align: center; }
  .items td.desc { text-transform: uppercase; }
  .meta { margin-top: 16px; line-height: 1.9; font-size: 14px; padding-left: 4px; }
  .meta b { font-weight: 700; }
  .sign { display: flex; justify-content: space-between; margin-top: 90px; padding: 0 4px; }
  .sign > div { width: 22%; font-size: 14px; }
  .sign .line { margin-top: 84px; border-top: 1px solid #000; width: 100%; }
  @media screen { body { padding: 16mm; max-width: 210mm; margin: 0 auto; } }
</style></head>
<body>
  <div class="head">
    <div class="co">
      <h1>${esc(lh.name)}</h1>
      <div class="addr">${(lh.addressLines || []).map(esc).join('<br>')}</div>
    </div>
    <div class="right">
      ${p.issuerLogo ? `<img src="${esc(p.issuerLogo)}" alt="">` : ''}
      <table class="num">
        <tr><td>SPP. No</td><td>${esc(p.sppNo) || '&nbsp;'}</td></tr>
        <tr><td>SPP. Date</td><td>${fmtDate(p.sppDate)}</td></tr>
      </table>
    </div>
  </div>

  <div class="boxes">
    <div class="col">
      ${box('Delivery To', p.deliveryTo)}
      ${box('Vessel Name', p.supplyVessel)}
    </div>
    <div class="col">
      ${box('Delivery Location', p.portDestination)}
    </div>
  </div>

  <table class="items">
    <tr><th style="width:15%">No</th><th style="width:43%">Description</th><th>Qty (Liters)</th></tr>
    <tr><td class="c">1</td><td class="desc">${esc(p.product) || '&nbsp;'}</td><td class="c">${fmtQty(p.quantityL)}</td></tr>
  </table>

  <div class="meta">
    <div><b>Estimate Delivery Date :</b> ${est}</div>
    <div><b>Note :</b> ${esc(p.note) || '-'}</div>
  </div>

  <div class="sign">
    <div>Issued By,<div class="line"></div></div>
    <div>Approved By,<div class="line"></div></div>
    <div>Delivery By,<div class="line"></div></div>
    <div>Received By,<div class="line"></div></div>
  </div>
</body></html>`;
}
