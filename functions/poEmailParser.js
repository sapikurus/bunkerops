// poEmailParser.js — read bunker PO requests out of a client email.
//
// Daidan sends a table: No · No PO · Nama Kapal · Entity · Lokasi · Qty (Liter)
// · PIC KAPAL, one row per PO. This parser reads it with fixed rules (no AI), so
// the result is predictable and cannot be steered by wording in the email.
//
// Order of attempts:
//   1. HTML table   — Gmail keeps the original table in the HTML body.
//   2. Plain text   — the same table flattened to one cell per line.
// No table → no drafts. (Loose PO numbers in an email — e.g. an "official PO"
// cover email with the PO as a PDF — never create sales orders.)
// Anything that can't be read cleanly is left blank and noted in `warnings`;
// a supervisor completes it before approving.

// Daidan PO shape: PO25-2610-0140 (tolerates P025 / P0O typos).
const PO_RE  = /\bP[O0]?\d{1,4}-\d{4}-\d{2,6}\b/gi;   // global: find all
const PO_ONE = /\bP[O0]?\d{1,4}-\d{4}-\d{2,6}\b/i;    // single check (no lastIndex state)

// Column header recognisers (Indonesian + English). Order matters: "No PO"
// must be tested before the plain row-number "No".
const COLS = [
  ['po',       /^(no\.?\s*po|po\s*(no\.?|number|nomor)?|nomor\s*po)$/i],
  ['no',       /^(no\.?|#|nomor)$/i],
  ['pic',      /^(pic|contact|kontak)\b/i],     // before vessel: "PIC KAPAL" contains "kapal"
  ['vessel',   /(nama\s*kapal|^kapal|vessel|ship)/i],
  ['entity',   /(entity|entitas|perusahaan|company)/i],
  ['location', /(lokasi|location|pelabuhan|port)/i],
  ['qty',      /(qty|quantity|jumlah|volume|liter)/i],
];
const colOf = (label) => {
  const t = String(label || '').trim();
  for (const [key, re] of COLS) if (re.test(t)) return key;
  return null;
};

const decode = (s) => String(s || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const cellText = (html) => decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();

// "27,000" / "27.000" / "27000 L" → 27000. Returns null when unclear.
function parseQty(v) {
  const t = String(v ?? '').replace(/\s|liter|ltr|l\b/gi, '');
  if (!t) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

// Build a row from header keys + cell values; validate the parts we rely on.
function toRow(keys, cells) {
  const raw = {};
  keys.forEach((k, i) => { if (k && raw[k] == null) raw[k] = (cells[i] ?? '').trim(); });
  const po = (String(raw.po || '').match(PO_ONE) || [])[0];
  if (!po) return null;
  const warnings = [];
  const qty = parseQty(raw.qty);
  if (raw.qty && qty == null) warnings.push(`quantity "${raw.qty}" not readable`);
  return {
    po: po.toUpperCase(),
    vessel: raw.vessel || '',
    entityCode: raw.entity || '',
    location: raw.location || '',
    qtyL: qty,
    pic: raw.pic || '',
    warnings,
  };
}

// 1. HTML tables
function fromHtml(html) {
  const out = [];
  for (const table of String(html || '').match(/<table[\s\S]*?<\/table>/gi) || []) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    let keys = null;
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(cellText);
      if (!keys) {
        const k = cells.map(colOf);
        if (k.includes('po')) keys = k;            // header row found
        continue;
      }
      const row = toRow(keys, cells);
      if (row) out.push(row);
    }
  }
  return out;
}

// 2. Plain text: the table flattened to one cell per line.
function fromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/ /g, ' ').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (colOf(lines[i]) !== 'po') continue;
    // Header block: walk back over a "No." label, then forward over header labels.
    let start = i;
    if (i > 0 && colOf(lines[i - 1]) === 'no') start = i - 1;
    const keys = [];
    let j = start;
    while (j < lines.length && colOf(lines[j]) && !PO_ONE.test(lines[j])) { keys.push(colOf(lines[j])); j++; }
    if (keys.length < 2) continue;
    // Rows: consecutive groups of keys.length cells, each with a PO in the PO column.
    const poIdx = keys.indexOf('po');
    while (j + keys.length <= lines.length) {
      const cells = lines.slice(j, j + keys.length);
      const row = toRow(keys, cells);
      if (!row || !PO_ONE.test(String(cells[poIdx] || ''))) break;
      out.push(row);
      j += keys.length;
    }
    if (out.length) return out;
  }
  return out;
}

// Every PO number in the text (used to recognise official-PO emails).
function poNumbers(text) {
  return [...new Set((String(text || '').match(PO_RE) || []).map(m => m.toUpperCase()))];
}

// An "official PO" email: the formal PO for an order already requested.
// Recognised by its subject ("OFFICIAL PO SEREIA 87", "Official P.O. …").
const isOfficialPO = (subject) => /\bofficial\s*p\.?\s*o\b/i.test(String(subject || ''));

// Fuel named in the subject or text, as a hint for the reviewer. The blend
// (B40/B50) wins over the generic "Biosolar": "Fuel Biosolar B50" → B50.
function fuelHint(text) {
  const t = String(text || '');
  const blend = t.match(/\bB(\d{2})\b/i);
  if (blend) return `B${blend[1]}`;
  const m = t.match(/\b(HSD|MFO|LSFO|HSFO|MGO|Bio\s*Solar)\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/g, '') : '';
}

/**
 * Parse a PO-request email.
 * @param {{html?: string, text?: string}} msg
 * @returns {{ rows: object[], method: 'html'|'text'|'none', fuelHint: string }}
 */
function parsePOEmail({ html, text, subject }) {
  const plain = text || cellText(html);
  let rows = fromHtml(html); let method = 'html';
  if (!rows.length) { rows = fromText(text); method = rows.length ? 'text' : 'none'; }
  // Same PO twice in one email (e.g. quoted twice) → keep the first.
  const seen = new Set();
  rows = rows.filter(r => (seen.has(r.po) ? false : seen.add(r.po)));
  return { rows, method, fuelHint: fuelHint(`${subject || ''}\n${plain}`) };
}

// Normalise a PO for duplicate checks: PO48-2610-0010 == P048-2610-10.
function normPO(v) {
  const t = String(v ?? '').toUpperCase().replace(/\s+/g, '');
  const m = t.match(/^P[O0]?(\d+)-(\d+)-(\d+)$/);
  return m ? `P${Number(m[1])}-${m[2]}-${Number(m[3])}` : t.replace(/[^A-Z0-9]/g, '');
}

// Entity matching against the Clients master: code field (if ever added), the
// initials of the PT name (AMN = PT. Aman Maritim Nusantara), or the full name.
const initials = (name) => String(name || '')
  .replace(/^\s*PT\.?\s+/i, '').replace(/\bTbk\.?\b/gi, '')
  .split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase()).join('');
const squash = (s) => String(s || '').toUpperCase().replace(/^PT\.?\s+/, '').replace(/[^A-Z0-9]/g, '');

function matchEntity(clients, code) {
  const c = String(code || '').trim();
  if (!c) return { match: null, note: 'no entity in the email' };
  const hits = [];
  for (const cl of clients || []) {
    for (const e of cl.entities || []) {
      if ((e.code && e.code.toUpperCase() === c.toUpperCase()) ||
          initials(e.name) === c.toUpperCase() ||
          squash(e.name) === squash(c)) hits.push({ client: cl, entity: e });
    }
  }
  if (hits.length === 1) return { match: hits[0], note: '' };
  if (hits.length > 1) return { match: null, note: `entity "${c}" matches ${hits.length} entities — pick one` };
  return { match: null, note: `entity "${c}" not found in Clients` };
}

function matchVessel(entity, name) {
  const n = squash(name);
  if (!n) return { vessel: '', note: 'no vessel in the email' };
  const v = (entity?.vessels || []).find(x => squash(x.name) === n);
  if (v) return { vessel: v.name, note: '' };
  return { vessel: String(name).trim().toUpperCase(), note: `vessel "${name}" not in this entity's vessel list` };
}

// PO prefix = the client entity's PO series: PO25-… is AMN, PO43-… is BTS.
const poPrefix = (po) => (normPO(po).match(/^P(\d+)-/) || [])[1] || '';

// Find the entity for one email row. Tries, in order:
//   1. the entity code in the email (AMN → PT Aman Maritim Nusantara);
//      if the code fits several entities, the one owning the vessel;
//   2. the vessel — the one entity in Clients that has this vessel;
//   3. the PO series — earlier sales orders with the same PO prefix all
//      belong to one entity.
// Steps 2–3 add a note so the reviewer checks the guess.
// history: [{ galleyPoRef, clientId, entityId }] of existing sales orders.
function resolveEntity(clients, { code, vessel, po }, history = []) {
  const all = [];
  for (const cl of clients || []) for (const e of cl.entities || []) all.push({ client: cl, entity: e });
  const hasVessel = (h) => !!vessel && (h.entity.vessels || []).some(v => squash(v.name) === squash(vessel));
  const notes = [];

  const byCode = matchEntity(clients, code);
  if (byCode.match) return { match: byCode.match, notes };
  if (code) {
    const c = String(code).trim().toUpperCase();
    const multi = all.filter(h => (h.entity.code || '').toUpperCase() === c || initials(h.entity.name) === c);
    const narrowed = multi.filter(hasVessel);
    if (narrowed.length === 1) return { match: narrowed[0], notes };
  }
  notes.push(byCode.note);

  const viaVessel = all.filter(hasVessel);
  if (viaVessel.length === 1) {
    notes.push(`entity taken from the vessel list (${viaVessel[0].entity.name}) — check`);
    return { match: viaVessel[0], notes };
  }

  const pre = poPrefix(po);
  if (pre) {
    const ids = new Set(history.filter(h => h.entityId && poPrefix(h.galleyPoRef) === pre).map(h => `${h.clientId}|${h.entityId}`));
    if (ids.size === 1) {
      const [cid, eid] = [...ids][0].split('|');
      const hit = all.find(h => h.client.id === cid && h.entity.id === eid);
      if (hit) {
        notes.push(`entity taken from earlier ${String(po).split("-")[0].toUpperCase()}-… orders (${hit.entity.name}) — check`);
        return { match: hit, notes };
      }
    }
  }
  return { match: null, notes };
}

module.exports = { parsePOEmail, parseQty, normPO, initials, matchEntity, matchVessel,
  resolveEntity, isOfficialPO, poNumbers, fuelHint };
