// BAST (Berita Acara Serah Terima BBM Solar) generator — bunkerops
// Always issued by USI PTS as operator. Produces the 4-copy set in one PDF:
// ORIGINAL, COPY-1, COPY-2, COPY-3 — each an identical page with a diagonal watermark.
// Portable HTML builder (mirrors letterGen.js) for direct reuse in React.

const COPIES = ['ORIGINAL', 'COPY-1', 'COPY-2', 'COPY-3'];

function bastPage(cfg, copyLabel) {
  const {
    usiLogo,
    nomorBast, tanggalBast,          // doc no + date
    hari, tanggalTeks,               // 'Jumat', '19 Desember 2025'
    supplier,                        // { name (cargo owner), deliveryOrder }
    penyalur,                        // { name (distributor), vesselName, nakhoda, quantity }
    recipient,                       // { entityName, vesselName, receiverName }
    deliveredFrom,                   // { facility, port }
    qty,                             // { volumeDiterima, shoreTank, fmAwal, fmAkhir, suhu, jamStart, jamEnd }
    uom,                             // unit of measurement, e.g. 'Liter'
    note,                            // free-text remarks (disputes etc.)
    qrDataUrl,                       // QR image data URL for verification
    verifyCode,                      // short code shown under QR
    signers,                         // { diserahkan, diterima, diketahui }
  } = cfg;

  const wmColor = copyLabel === 'ORIGINAL' ? '#d33' : '#d9a3a3';
  const row = (k, v) => `<tr><td class="k">${k}</td><td class="c">:</td><td class="v">${v ?? ''}</td></tr>`;
  const u = uom ? ` ${uom}` : '';
  const num = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? v : n.toLocaleString('id-ID') + u;
  };

  return `
  <div class="page">
    <div class="wm" style="color:${wmColor}">${copyLabel}</div>

    <div class="frame">
      <div style="padding:0">
        <table class="hdr">
          <tr>
            <td class="logo"><img src="${usiLogo}" /></td>
            <td class="title">BERITA ACARA SERAH<br>TERIMA BBM SOLAR</td>
            <td class="nomor">
              <table>
                <tr><td class="nk">Nomor<br>BAST</td><td class="nv">${nomorBast}</td>
                    <td class="cp" rowspan="2" style="color:${wmColor}">${copyLabel}</td></tr>
                <tr><td class="nk">Tanggal<br>BAST</td><td class="nv">${tanggalBast}</td></tr>
              </table>
            </td>
          </tr>
        </table>

        <div class="body">
          <p class="intro">Dengan ini menyatakan bahwa pada hari, &nbsp;<b>${hari}</b>&nbsp;, tanggal, &nbsp;<b>${tanggalTeks}</b><br>
          telah menyerahkan BBM Bio Solar dengan keterangan sebagai berikut :</p>

          <div class="sec"><span class="num">1.</span><b>Supplier (Cargo Owner)</b></div>
          <table class="kv">
            ${row('Name', supplier.name)}
            ${row('Delivery Order', supplier.deliveryOrder)}
          </table>

          <div class="sec"><span class="num">2.</span><b>Penyalur (Distributor)</b></div>
          <table class="kv">
            ${row('Name', penyalur.name)}
            ${row('Vessel Name', penyalur.vesselName)}
            ${row('Nakhoda', penyalur.nakhoda)}
            ${row('Quantity', num(penyalur.quantity))}
          </table>

          <div class="sec"><span class="num">3.</span><b>Recipient (Penerima)</b></div>
          <table class="kv">
            ${row('Client', recipient.entityName)}
            ${row('Vessel Name', recipient.vesselName)}
            ${row('Penerima', recipient.receiverName)}
          </table>

          <div class="sec"><span class="num">4.</span><b>Delivered From</b></div>
          <table class="kv">
            ${row('Facility', deliveredFrom.facility)}
            ${row('Port', deliveredFrom.port)}
          </table>

          <div class="sec"><span class="num">5.</span><b>Quantity</b></div>
          <table class="kv">
            ${row('Volume Observed', num(qty.volumeObserved))}
            ${row('Liter Standard (@15°C)', num(qty.literStandard))}
            ${row('Shore Tank', num(qty.shoreTank))}
            ${row('Flow meter Awal', num(qty.fmAwal))}
            ${row('Flow meter Akhir', num(qty.fmAkhir))}
            ${row('Suhu / Temp (°C)', qty.suhu)}
            ${row('Density', qty.density)}
            ${row('Water Content', qty.waterContent)}
            ${row('Jam Start Flow', qty.jamStart)}
            ${row('Jam End Flow', qty.jamEnd)}
          </table>

          <p class="closing">Demikian Berita Acara ini dibuat dengan sebenarnya agar dapat dipergunakan seperlunya.</p>

          <table class="remarks-qr"><tr>
            <td class="rq-note">
              <div class="notebox">
                <div class="notebox-label">Catatan / Remarks:</div>
                <div class="notebox-body">${note && note.trim() ? note.replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''}</div>
              </div>
            </td>
            <td class="rq-qr">
              ${qrDataUrl ? `<img src="${qrDataUrl}" alt="verify" />
              <div class="qc">Scan to verify${verifyCode ? `<br>${verifyCode}` : ''}</div>` : ''}
            </td>
          </tr></table>
        </div>
      </div>

      <div class="sign-anchor">
        <table class="sign">
          <tr class="sh"><td>Diserahkan Oleh</td><td>Diterima Oleh</td><td>Diketahui Oleh</td></tr>
          <tr class="sp"><td></td><td></td><td></td></tr>
          <tr class="snm"><td>${signers.diserahkan.name||''}</td><td>${signers.diterima.name||''}</td><td>${signers.diketahui.name||''}</td></tr>
          <tr class="srole"><td>${signers.diserahkan.role||''}</td><td>${signers.diterima.role||''}</td><td>${signers.diketahui.role||''}</td></tr>
        </table>
      </div>
    </div>
  </div>`;
}

export function buildBASTHtml(cfg) {
  const pages = COPIES.map(c => bastPage(cfg, c)).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>BAST ${cfg.nomorBast}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial, sans-serif; color:#111; }
  /* A4 297mm − 14mm×2 padding = 269mm inner height. Frame is a fixed-height positioned
     box; signature block is absolutely pinned to its bottom. wkhtmltopdf ignores table
     height attributes, so we position rather than stretch. */
  .page { position:relative; width:210mm; height:297mm; padding:14mm; page-break-after:always; }
  .page:last-child { page-break-after:auto; }
  .wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg);
        font-size:72pt; font-weight:bold; opacity:.28; letter-spacing:4px; pointer-events:none;
        z-index:0; white-space:nowrap; }
  .frame { position:relative; z-index:1; border:1.5px solid #000; width:100%; height:269mm; }
  .sign-anchor { position:absolute; left:0; right:0; bottom:0; }
  table.hdr { width:100%; border-collapse:collapse; }
  table.hdr > tr > td { border:1px solid #000; vertical-align:middle; }
  table.hdr .logo { width:150px; text-align:center; padding:8px; }
  table.hdr .logo img { height:34px; width:auto; }
  table.hdr .title { text-align:center; font-size:12pt; font-weight:bold; line-height:1.25; padding:8px; }
  table.hdr .nomor { width:230px; padding:0; }
  table.hdr .nomor table { width:100%; border-collapse:collapse; height:100%; }
  table.hdr .nomor td { border:1px solid #000; font-size:8pt; padding:3px 5px; }
  table.hdr .nomor .nk { width:52px; font-weight:normal; background:#fafafa; text-align:center; }
  table.hdr .nomor .nv { font-size:8.5pt; text-align:center; }
  table.hdr .nomor .cp { width:56px; text-align:center; font-weight:bold; font-size:9pt; }
  .body { padding:14px 20px 8px; font-size:10pt; }
  .intro { line-height:1.8; margin-bottom:14px; }
  .sec { margin:12px 0 4px; font-size:10pt; }
  .sec .num { display:inline-block; width:26px; }
  table.kv { border-collapse:collapse; margin-left:26px; }
  table.kv td { font-size:10pt; padding:2.5px 0; vertical-align:top; }
  table.kv .k { width:140px; }
  table.kv .c { width:12px; }
  table.kv .v { padding-left:6px; }
  .closing { margin:16px 0 10px; font-size:10pt; }
  .remarks-qr { width:100%; border-collapse:collapse; }
  .remarks-qr .rq-note { width:80%; vertical-align:top; padding-right:12px; }
  .remarks-qr .rq-qr { width:20%; vertical-align:bottom; text-align:center; }
  .remarks-qr .rq-qr img { width:66px; height:66px; }
  .remarks-qr .rq-qr .qc { font-size:6pt; color:#666; margin-top:2px; line-height:1.3; }
  .notebox { border:1px solid #999; border-radius:3px; padding:8px 10px; }
  .notebox-label { font-size:8.5pt; font-weight:bold; color:#444; margin-bottom:4px; }
  .notebox-body { font-size:9pt; color:#111; min-height:58px; line-height:1.6; white-space:pre-wrap; }
  table.sign { width:100%; border-collapse:collapse; }
  table.sign td { border:1px solid #000; text-align:center; font-size:9.5pt; }
  table.sign .sh td { padding:5px; }
  table.sign .sp td { height:52px; }
  table.sign .snm td { padding:4px; border-bottom:none; }
  table.sign .srole td { padding:3px; border-top:none; font-size:9pt; }
  @page { size:A4; margin:0; }
</style></head><body>
${pages}
</body></html>`;
}
