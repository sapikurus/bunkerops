// Delivery Order generator — bunkerops
// Portable HTML builder (mirrors letterGen.js pattern) so it drops straight into React.
// Issuer letterhead varies by scheme: PPS-sale -> PPS, VHS -> USI PTS. The uploaded
// sample was on the MBSS holding co. (Galley) letterhead; that is the *client's* PO doc,
// not our DO. Our DO issues under PPS or USI PTS. Here we template the issuer block so
// any of the three can be slotted in.

// Issuer letterhead presets. The DO always issues under one of OUR entities:
//   PPS_SALE scheme -> PPS ;  VHS scheme -> USI PTS.
// The caller passes issuerKey (defaulted from scheme) and the matching logo data-URI.
// (Galley was the MBSS holding-co on the sample; it is never OUR DO issuer.)
export const DO_ISSUERS = {
  PPS: {
    name: 'PT. PETROPRIMA SEJAHTERA',
    addrLines: [
      'Jln. P. Antasari 66B, Teluk Lerong Ulu, Sungai Kunjang,',
      'Samarinda – Kalimantan Timur',
      'info@petroprimasejahtera.net',
    ],
  },
  USI_PTS: {
    name: 'PT. USI PETROTRANS SAMUDRA',
    addrLines: [
      'Ruko Satellite Town Square Blok A9-A10,',
      'Jl. Raya Sukomanunggal Jaya, Surabaya 60189',
      'marketing@ptusi.co.id',
    ],
  },
};

export function buildDOHtml(cfg) {
  const {
    issuerKey,         // 'PPS' | 'USI_PTS' — chosen by user, defaulted from scheme
    issuerLogo,        // data-URI logo for the chosen issuer
    brNo, brDate,      // document number + date
    deliverTo,         // client entity receiving (e.g. PT AMAN MARITIM NUSANTARA)
    deliverLocation,   // e.g. IWIP
    vesselName,        // e.g. SEREIA 75
    items,             // [{ no, description, qtyLiters }]
    estDeliveryDate,   // 'DD-MMM-YYYY HH:mm'
    note,              // free text or '-'
    signers,           // { issuedBy:{role,name}, approvedBy:{role,name}, deliveryBy:{role,name}, receivedBy:{role,name} }
    scheme,            // 'VHS' | 'PPS_SALE' — shown as a small tag
  } = cfg;

  const issuer = { ...DO_ISSUERS[issuerKey || (scheme === 'PPS_SALE' ? 'PPS' : 'USI_PTS')], logo: issuerLogo };

  // Format a date to DD/MM/YYYY. Accepts 'YYYY-MM-DD' or a Date-parseable string.
  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt)) return d; // leave as-is if unparseable
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()}`;
  };

  const rows = (items || []).map(it => `
    <tr>
      <td style="text-align:center">${it.no}</td>
      <td>${it.description}</td>
      <td style="text-align:right">${Number(it.qtyLiters).toLocaleString('en-US')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Delivery Order ${brNo}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial, sans-serif; font-size:10pt; color:#111; padding:18mm 16mm; }
  .issuer h1 { font-size:13pt; font-weight:bold; letter-spacing:.3px; }
  .issuer .addr { font-size:8pt; color:#333; line-height:1.4; margin-top:2px; max-width:340px; }
  .brbox { border-collapse:collapse; font-size:9pt; }
  .brbox td { border:1px solid #000; padding:3px 8px; }
  .brbox td.k { font-weight:bold; background:#f2f2f2; }
  .two { width:100%; border-collapse:separate; table-layout:fixed; }
  .two .cell { border:1px solid #000; padding:0; vertical-align:top; width:48%; }
  .two .gap { width:4%; border:none; }
  .cell .h { font-weight:bold; font-size:9pt; padding:4px 8px; border-bottom:1px solid #000; background:#f7f7f7; }
  .cell .v { padding:6px 8px; font-size:10pt; min-height:26px; }
  table.items { width:100%; border-collapse:collapse; margin-top:8px; }
  table.items th { border:1px solid #000; background:#f2f2f2; padding:5px 8px; font-size:9pt; }
  table.items td { border:1px solid #000; padding:5px 8px; font-size:10pt; }
  .meta { margin-top:10px; font-size:9pt; line-height:1.7; }
  .meta b { font-weight:bold; }
  .tag { display:inline-block; font-size:7.5pt; border:1px solid #888; border-radius:3px;
         padding:1px 6px; color:#555; margin-left:8px; vertical-align:middle; }
  .sign { width:100%; border-collapse:collapse; margin-top:34px; table-layout:fixed; }
  .sign td { width:25%; text-align:center; vertical-align:top; }
  .sign .lbl td { font-size:9pt; padding-bottom:0; }
  .sign .gap td { height:56px; }
  .sign .role td { font-size:9pt; font-weight:bold; border-top:1px solid #000; padding-top:3px; }
  .sign .nm td { font-size:9pt; }
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
        <tr><td class="k">DO. No</td><td>${brNo}</td></tr>
        <tr><td class="k">DO. Date</td><td>${fmtDate(brDate)}</td></tr>
      </table>
    </td>
  </tr></table>

  <div style="height:8px"></div>

  <table class="two"><tr>
    <td class="cell">
      <div class="h">Delivery To</div>
      <div class="v">${deliverTo}</div>
    </td>
    <td class="gap"></td>
    <td class="cell">
      <div class="h">Delivery Location</div>
      <div class="v">${deliverLocation}</div>
    </td>
  </tr></table>
  <table class="two" style="margin-top:8px"><tr>
    <td class="cell">
      <div class="h">Vessel Name</div>
      <div class="v">${vesselName}</div>
    </td>
    <td class="gap"></td>
    <td></td>
  </tr></table>

  <table class="items">
    <thead>
      <tr><th style="width:48px">No</th><th style="text-align:left">Description</th><th style="width:120px">Qty (Liters)</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="meta">
    <b>Estimate Delivery Date :</b> ${estDeliveryDate || '-'}<br>
    <b>Note :</b> ${note || '-'}
  </div>

  <table class="sign">
    <tr class="lbl">
      <td>Issued By,</td><td>Approved By,</td><td>Delivery By,</td><td>Received By,</td>
    </tr>
    <tr class="gap"><td></td><td></td><td></td><td></td></tr>
    <tr class="role">
      <td>${signers.issuedBy.role}</td>
      <td>${signers.approvedBy.role}</td>
      <td>${signers.deliveryBy.role}</td>
      <td>${signers.receivedBy.role}</td>
    </tr>
    <tr class="nm">
      <td>${signers.issuedBy.name||''}</td>
      <td>${signers.approvedBy.name||''}</td>
      <td>${signers.deliveryBy.name||''}</td>
      <td>${signers.receivedBy.name||''}</td>
    </tr>
  </table>

</body></html>`;
}
