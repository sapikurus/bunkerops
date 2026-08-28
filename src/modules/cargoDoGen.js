// Incoming-cargo Delivery Order (SPP — Surat Pengantar Pengiriman) generator.
// SEPARATE from the sales-side DO (doGen.js). Accompanies an incoming cargo
// receipt and is used to APPLY FOR A BUNKER PERMIT at the port authority.
//
// Issued under PPS (the cargo owner). Carries an auto-generated SPP number in
// the Ref. No box; the body shows a single user-typed reference (the PO / cargo
// ref). Reuses the letterhead preset + print CSS from doGen.js for house style.

import { DO_ISSUERS } from './doGen';

export function buildCargoDOHtml(cfg) {
  const {
    issuerLogo,        // data-URI logo (PPS)
    sppNo,             // auto-generated SPP number -> Ref. No box
    printDate,         // ISO — when generated (defaults today)
    estDeliveryDate,   // ISO — estimated delivery date (user input)
    quantityL,         // number (L) — user input
    product,           // string — fuel type / cargo item name
    portLoading,       // string — load port (user input)
    portDestination,   // string — destination node/port (dropdown)
    supplyVessel,      // string — user input
    referenceNo,       // string — user-typed PO / cargo reference
    recipientName,     // optional — printed under the recipient signature
    note,              // optional free text
  } = cfg;

  // Always issued under PPS (cargo owner) for the permit application.
  const issuer = { ...DO_ISSUERS.PPS, logo: issuerLogo };

  const fmtDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()}`;
  };
  const fmtL = (n) => (Number(n) || 0).toLocaleString('id-ID');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Delivery Order ${sppNo || ''}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial, sans-serif; font-size:10pt; color:#111; padding:18mm 16mm; }
  .issuer h1 { font-size:13pt; font-weight:bold; letter-spacing:.3px; }
  .issuer .addr { font-size:8pt; color:#333; line-height:1.4; margin-top:2px; max-width:340px; }
  .brbox { border-collapse:collapse; font-size:9pt; }
  .brbox td { border:1px solid #000; padding:3px 8px; }
  .brbox td.k { font-weight:bold; background:#f2f2f2; }
  .title { text-align:center; font-size:12pt; font-weight:bold; letter-spacing:1px;
           text-transform:uppercase; margin:14px 0 14px; }
  table.fields { width:100%; border-collapse:collapse; margin-top:8px; }
  table.fields td { border:1px solid #000; padding:7px 10px; font-size:10pt; vertical-align:top; }
  table.fields td.k { font-weight:bold; background:#f7f7f7; width:210px; }
  .note { margin-top:14px; font-size:9pt; line-height:1.7; }
  .foot { margin-top:48px; width:100%; table-layout:fixed; border-collapse:collapse; }
  .foot td { width:50%; text-align:center; vertical-align:top; font-size:9pt; }
  .foot .gap td { height:56px; }
  .foot .nm td { font-weight:bold; padding-top:3px; }
  .foot .role td { border-top:1px solid #000; padding-top:3px; }
  @page { size:A4; margin:14mm; }
</style></head><body>

  <table style="width:100%;border-collapse:collapse;margin-bottom:6px"><tr>
    <td style="vertical-align:middle">
      <div class="issuer">
        <h1>${issuer.name}</h1>
        <div class="addr">${(issuer.addrLines||[]).join('<br>')}</div>
      </div>
    </td>
    <td style="vertical-align:middle;text-align:center;width:120px">
      ${issuer.logo ? `<img src="${issuer.logo}" style="height:44px;width:auto" />` : ''}
    </td>
    <td style="vertical-align:middle;text-align:right;width:250px">
      <table class="brbox" style="margin-left:auto">
        <tr><td class="k">Ref. No</td><td>${sppNo || '-'}</td></tr>
        <tr><td class="k">Date</td><td>${fmtDate(printDate)}</td></tr>
      </table>
    </td>
  </tr></table>

  <div class="title">Delivery Order</div>

  <table class="fields">
    <tr>
      <td class="k">Estimated Delivery Date</td>
      <td>${fmtDate(estDeliveryDate)}</td>
    </tr>
    <tr>
      <td class="k">Product</td>
      <td>${product || '-'}</td>
    </tr>
    <tr>
      <td class="k">Quantity</td>
      <td>${fmtL(quantityL)} Liter</td>
    </tr>
    <tr>
      <td class="k">Port Loading</td>
      <td>${portLoading || '-'}</td>
    </tr>
    <tr>
      <td class="k">Port Destination</td>
      <td>${portDestination || '-'}</td>
    </tr>
    <tr>
      <td class="k">Supply Vessel</td>
      <td>${supplyVessel || '-'}</td>
    </tr>
    <tr>
      <td class="k">Reference Number</td>
      <td>${referenceNo || '-'}</td>
    </tr>
  </table>

  ${note ? `<div class="note"><b>Note :</b> ${note}</div>` : ''}

  <table class="foot">
    <tr class="lbl"><td></td><td>Recipient,</td></tr>
    <tr class="gap"><td></td><td></td></tr>
    <tr class="nm"><td></td><td>${recipientName || ''}</td></tr>
    <tr class="role"><td></td><td>Recipient</td></tr>
  </table>

</body></html>`;
}
