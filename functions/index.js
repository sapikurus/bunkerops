// bunkerops Cloud Functions
// -----------------------------------------------------------------------------
// Purpose: when an operator fills a BAST (status → 'bast_done'), advance the
// linked Delivery Order (→ 'delivered') and Sales Request (→ 'bast_done').
// When a BAST is later REOPENED (status leaves 'bast_done', e.g. back to
// 'blank'), revert the DO (→ 'issued') and SO (→ 'do_issued') so the documents
// stay honest through revisions.
//
// Operators do NOT have Firestore write access to deliveryOrders / salesRequests
// (by design — no tampering). This function runs with admin privileges and
// performs those status flips server-side, so the operator only writes the BAST.
//
// Trigger: any write to bunkerops_bast/{bastId}. We act only on the status
// TRANSITION into or out of 'bast_done' — a plain revision that keeps the BAST
// 'bast_done' touches nothing downstream.
//
// Deploy:  firebase deploy --only functions
// Region:  asia-southeast1 (Singapore). If your Firestore is asia-southeast2
//          (Jakarta), change the region string below and redeploy — the function
//          works either way, co-locating just trims latency.
// Runtime: Node 20, Firebase Functions v2.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

const COL = {
  bast: 'bunkerops_bast',
  deliveryOrders: 'bunkerops_deliveryOrders',
  salesRequests: 'bunkerops_salesRequests',
};

// Status values used for the forward flip and the reverse (revert) flip.
const DO_DONE   = 'delivered';
const DO_OPEN   = 'issued';
const SO_DONE   = 'bast_done';
const SO_OPEN   = 'do_issued';

exports.onBastStatusChange = onDocumentWritten(`${COL.bast}/{bastId}`, async (event) => {
  const before = event.data?.before?.data() || null;
  const after  = event.data?.after?.data()  || null;
  const bastId = event.params.bastId;

  // Document deleted — leave DO/SO as-is (deletes are no longer allowed anyway).
  if (!after) return;

  // A cancelled BAST never moves its DO / SO (cancellation is set by the app on
  // all three documents together).
  if (after.status === 'cancelled') return;

  const wasDone = before?.status === 'bast_done';
  const isDone  = after.status === 'bast_done';

  // No change across the 'bast_done' boundary → nothing to do. This is the
  // common case of revising a completed BAST (adding/correcting info): status
  // stays 'bast_done', so DO/SO are untouched.
  if (wasDone === isDone) return;

  // The DO id can be on either snapshot; prefer the current one.
  const deliveryOrderId = after.deliveryOrderId || before?.deliveryOrderId;
  if (!deliveryOrderId) {
    console.log(`BAST ${bastId} has no deliveryOrderId; nothing to advance/revert.`);
    return;
  }

  // Forward (fill) vs. reverse (reopen) target statuses.
  const doTarget = isDone ? DO_DONE : DO_OPEN;
  const soTarget = isDone ? SO_DONE : SO_OPEN;
  const direction = isDone ? 'advance' : 'revert';

  try {
    const doRef = db.collection(COL.deliveryOrders).doc(deliveryOrderId);
    const doSnap = await doRef.get();
    if (!doSnap.exists) {
      console.warn(`DO ${deliveryOrderId} not found for BAST ${bastId}.`);
      return;
    }
    const doData = doSnap.data();

    // Never revive a cancelled DO (or its SO) — cancellations are final.
    if (doData.status === 'cancelled') {
      console.log(`DO ${deliveryOrderId} is cancelled; BAST ${bastId} change ignored.`);
      return;
    }

    if (doData.status !== doTarget) {
      await doRef.update({ status: doTarget });
      console.log(`[${direction}] DO ${deliveryOrderId} → ${doTarget} (BAST ${bastId}).`);
    }

    const salesRequestId = doData.salesRequestId;
    if (salesRequestId) {
      const soRef = db.collection(COL.salesRequests).doc(salesRequestId);
      const soSnap = await soRef.get();
      if (soSnap.exists && soSnap.data().status !== 'cancelled' && soSnap.data().status !== soTarget) {
        await soRef.update({ status: soTarget });
        console.log(`[${direction}] SO ${salesRequestId} → ${soTarget}.`);
      }
    }
  } catch (err) {
    console.error(`onBastStatusChange (${direction}) failed for BAST ${bastId}:`, err);
    throw err; // retry on transient errors
  }
});

// -----------------------------------------------------------------------------
// getFinalPOs — read the final-PO list from the team's shared Google Sheet.
//
// Used by Commercial → PO CHECK to list BAST-done sales orders whose final PO
// is not in the sheet yet, without anyone downloading a CSV.
//
// Security:
// - The sheet stays PRIVATE. It is shared (Viewer) with this function's service
//   account only; the function reads it with its own Google identity — no keys
//   or passwords are stored anywhere.
// - Only the "PO Reference" column is returned. Prices, amounts and payment
//   data in the sheet never leave the server.
// - Callable only by signed-in commercial / director / superadmin users (the
//   same roles that see the Commercial page).
// -----------------------------------------------------------------------------
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');

const PO_SHEET = {
  id:  '1C5Fh5_1I8cbEbTXXKeFA-NOIi9Zj54Y2Sqte6vF7vVo',  // OUTSTANDING_USI-PPS
  tab: 'MASTER',
};
const OWNER_EMAIL = 'info@petroprimasejahtera.net';            // break-glass superadmin
const PO_CHECK_ROLES = ['superadmin', 'director', 'commercial'];

// Pull the "PO Reference" column out of the sheet's rows (header found by name,
// so moving the column in the sheet doesn't break this).
function extractPoColumn(values) {
  const rows = Array.isArray(values) ? values : [];
  const hi = rows.findIndex(r => (r || []).some(c => /^\s*po\s*ref/i.test(String(c || ''))));
  if (hi < 0) return null;
  const col = rows[hi].findIndex(c => /^\s*po\s*ref/i.test(String(c || '')));
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const v = String((r || [])[col] ?? '').trim();
    if (v) out.push(v);
  }
  return out;
}

const sheetsAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });

exports.getFinalPOs = onCall(async (request) => {
  // 1. Caller must be signed in with a commercial-capable role.
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = String(auth.token?.email || '').toLowerCase();
  let allowed = email === OWNER_EMAIL;
  if (!allowed) {
    const u = await db.collection('bunkerops_users').doc(auth.uid).get();
    allowed = u.exists && PO_CHECK_ROLES.includes(u.data().role);
  }
  if (!allowed) {
    throw new HttpsError('permission-denied', 'PO CHECK is limited to commercial, director and superadmin.');
  }

  // 2. Read the sheet tab with the function's own service account.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${PO_SHEET.id}` +
              `/values/${encodeURIComponent(PO_SHEET.tab)}?majorDimension=ROWS`;
  let values;
  try {
    const client = await sheetsAuth.getClient();
    const res = await client.request({ url });
    values = res.data?.values || [];
  } catch (err) {
    const status = err?.response?.status;
    const msg = String(err?.response?.data?.error?.message || err?.message || err);
    let sa = 'this function\'s service account';
    try { sa = (await sheetsAuth.getCredentials()).client_email || sa; } catch { /* best effort */ }
    console.error(`getFinalPOs: sheet read failed (${status}): ${msg}`);
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
      throw new HttpsError('failed-precondition',
        'The Google Sheets API is not enabled for this project. Enable it in Google Cloud Console → APIs & Services, then retry.');
    }
    if (status === 403 || status === 404) {
      throw new HttpsError('failed-precondition',
        `The function can't open the sheet. Share it as Viewer with ${sa}, then retry.`);
    }
    throw new HttpsError('internal', 'Could not read the PO sheet: ' + msg);
  }

  // 3. Return the PO column only.
  const pos = extractPoColumn(values);
  if (!pos) {
    throw new HttpsError('failed-precondition',
      `No "PO Reference" column found in the "${PO_SHEET.tab}" tab.`);
  }
  console.log(`getFinalPOs: ${pos.length} POs returned to ${email || auth.uid}.`);
  return { pos, count: pos.length, tab: PO_SHEET.tab, fetchedAt: new Date().toISOString() };
});


// -----------------------------------------------------------------------------
// ingestPOEmail — turn a client's PO-request email into DRAFT sales orders.
//
// Called by a Google Apps Script in Nic's Gmail (apps-script/PoEmailIntake.gs),
// which forwards each matching Daidan email here. Every PO row in the email
// becomes one sales order with status 'pending_approval' and NO SO number;
// a supervisor reviews, completes and approves it in Sales Requests.
//
// Safety:
// - Requires the shared secret (header X-Ingest-Secret, stored in Secret
//   Manager as EMAIL_INGEST_SECRET and in the script's properties).
// - Sender must be @daidan.co.id AND Gmail's authentication result must confirm
//   it (DKIM / DMARC / SPF pass for daidan.co.id) — a forged From line fails.
// - Each email is processed once (keyed by Gmail message id); each PO number
//   creates at most one sales order (existing, non-cancelled SOs are skipped).
// - The email is read with fixed rules (poEmailParser.js), never executed or
//   interpreted; it can only ever produce pending drafts.
// -----------------------------------------------------------------------------
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { parsePOEmail, normPO, matchEntity, matchVessel } = require('./poEmailParser');

const INGEST_SECRET = defineSecret('EMAIL_INGEST_SECRET');
const ALLOWED_SENDER_DOMAINS = ['daidan.co.id'];
const INTAKE_COL = 'bunkerops_emailIntake';

const senderAddress = (from) => {
  const m = String(from || '').match(/<([^>]+)>/) || String(from || '').match(/([^\s<>]+@[^\s<>]+)/);
  return (m ? m[1] : '').trim().toLowerCase();
};
const domainOf = (addr) => addr.split('@')[1] || '';

// Gmail's Authentication-Results header must vouch for the sender's domain.
function authenticated(authResults, domain) {
  const a = String(authResults || '').toLowerCase();
  const d = domain.replace(/\./g, '\\.');
  const end = '(?=[\\s;)]|$)';             // "daidan.co.id.evil.com" must not pass
  return new RegExp(`dkim=pass[^;]*header\\.(d|i)=@?([a-z0-9-]+\\.)*${d}${end}`).test(a) ||
         new RegExp(`dmarc=pass[^;]*header\\.from=([a-z0-9-]+\\.)*${d}${end}`).test(a) ||
         new RegExp(`spf=pass[^;]*smtp\\.mailfrom=([^;\\s@]*@)?([a-z0-9-]+\\.)*${d}${end}`).test(a);
}

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const jakartaDate = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  return (isNaN(d) ? new Date() : d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
};

exports.ingestPOEmail = onRequest({ secrets: [INGEST_SECRET], cors: false }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!sameSecret(req.get('X-Ingest-Secret'), INGEST_SECRET.value())) {
    return res.status(401).json({ error: 'bad secret' });
  }
  const b = req.body || {};
  const { messageId, from, subject, date, html, text, auth } = b;
  if (!messageId || (!html && !text)) return res.status(400).json({ error: 'messageId and html/text required' });
  if (String(html || '').length + String(text || '').length > 3_000_000) {
    return res.status(413).json({ error: 'email too large' });
  }

  const sender = senderAddress(from);
  const domain = domainOf(sender);
  const intakeId = crypto.createHash('sha256').update(String(messageId)).digest('hex').slice(0, 40);
  const intakeRef = db.collection(INTAKE_COL).doc(intakeId);
  const base = { messageId: String(messageId), from: String(from || ''), subject: String(subject || '').slice(0, 300),
    receivedAt: date || null, processedAt: FieldValue.serverTimestamp() };

  // Sender checks.
  if (!ALLOWED_SENDER_DOMAINS.includes(domain)) {
    return res.status(403).json({ error: `sender ${sender || '(none)'} is not an allowed client domain` });
  }
  if (!authenticated(auth, domain)) {
    await intakeRef.set({ ...base, status: 'rejected', reason: 'sender not authenticated (DKIM/SPF/DMARC)' }, { merge: true });
    return res.status(403).json({ error: 'sender not authenticated' });
  }

  // Process each email once: create() fails if this message was seen before.
  try {
    await intakeRef.create({ ...base, status: 'processing' });
  } catch (e) {
    if (e.code === 6 || /already exists/i.test(e.message)) return res.json({ duplicate: true, created: [], skipped: [] });
    throw e;
  }

  try {
    const parsed = parsePOEmail({ html, text });
    if (!parsed.rows.length) {
      await intakeRef.update({ status: 'no-rows', method: parsed.method });
      return res.json({ created: [], skipped: [], note: 'no PO rows found' });
    }

    const [clientsSnap, soSnap] = await Promise.all([
      db.collection('bunkerops_clients').get(),
      db.collection('bunkerops_salesRequests').get(),
    ]);
    const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const existing = new Map();
    for (const d of soSnap.docs) {
      const so = d.data();
      if (so.status === 'cancelled' || !so.galleyPoRef) continue;
      existing.set(normPO(so.galleyPoRef), { id: d.id, soNumber: so.soNumber || '(draft)' });
    }

    const requestedDate = jakartaDate(date);
    const excerpt = String(text || '').replace(/\n{3,}/g, '\n\n').slice(0, 1500);
    const batch = db.batch();
    const created = [], skipped = [];
    for (const row of parsed.rows) {
      const dup = existing.get(normPO(row.po));
      if (dup) { skipped.push({ po: row.po, reason: `already in BunkerOps (${dup.soNumber})` }); continue; }

      const notes = [...row.warnings];
      const ent = matchEntity(clients, row.entityCode);
      if (ent.note) notes.push(ent.note);
      let vesselName = String(row.vessel || '').toUpperCase();
      if (ent.match) {
        const v = matchVessel(ent.match.entity, row.vessel);
        vesselName = v.vessel; if (v.note) notes.push(v.note);
      }
      if (row.qtyL == null) notes.push('quantity missing');
      notes.push('choose the source node and confirm scheme and fuel type');

      const ref = db.collection('bunkerops_salesRequests').doc();
      batch.set(ref, {
        soNumber: '',                              // allocated on approval
        status: 'pending_approval',
        galleyPoRef: row.po,
        clientId: ent.match?.client.id || '',
        clientName: ent.match?.client.groupName || '',
        entityId: ent.match?.entity.id || '',
        entityName: ent.match?.entity.name || '',
        entityCodeFromEmail: row.entityCode || '',
        vesselName,
        scheme: 'PPS_SALE', bucket: 'PPS', issuerKey: 'PPS',   // default; reviewer confirms
        nodeId: '', nodeName: '', nodeCode: '',
        fuelTypeId: '', fuelTypeName: parsed.fuelHint || '', fuelTypeShort: '',
        requestedVolumeL: row.qtyL || 0,
        deliveryLocation: row.location || '',
        requestedDate,
        picContact: row.pic || '',
        intakeNotes: notes,
        source: { type: 'email', messageId: String(messageId), from: String(from || ''), subject: base.subject,
          receivedAt: date || null, method: parsed.method, excerpt },
        createdAt: FieldValue.serverTimestamp(),
      });
      existing.set(normPO(row.po), { id: ref.id, soNumber: '(draft)' });   // same PO twice in one email
      created.push({ po: row.po, soId: ref.id });
    }
    await batch.commit();
    await intakeRef.update({ status: 'processed', method: parsed.method, created, skipped });
    console.log(`ingestPOEmail: ${created.length} draft(s), ${skipped.length} skipped — ${base.subject}`);
    return res.json({ created, skipped });
  } catch (err) {
    console.error('ingestPOEmail failed:', err);
    await intakeRef.delete().catch(() => {});      // allow a retry of this email
    return res.status(500).json({ error: 'processing failed' });
  }
});

// -----------------------------------------------------------------------------
// emailIntakeControl — the app's buttons for the email intake.
//   action 'check'   → read the mailbox now (Sales Requests → 📧 CHECK EMAIL)
//   action 'status'  → is auto-check on? last run? (Settings)
//   action 'setAuto' → turn the 10-minute auto-check on/off (Settings)
// It forwards to the Apps Script web app in the mailbox account (URL stored as
// secret EMAIL_SCRIPT_URL), signed with the same EMAIL_INGEST_SECRET.
// -----------------------------------------------------------------------------
const EMAIL_SCRIPT_URL = defineSecret('EMAIL_SCRIPT_URL');
const EMAIL_CHECK_ROLES = ['superadmin', 'director', 'supervisor'];
const EMAIL_SETTING_ROLES = ['superadmin', 'director'];

async function roleOf(auth) {
  if (!auth) return null;
  if (String(auth.token?.email || '').toLowerCase() === OWNER_EMAIL) return 'superadmin';
  const u = await db.collection('bunkerops_users').doc(auth.uid).get();
  return u.exists ? u.data().role : null;
}

exports.emailIntakeControl = onCall(
  { secrets: [INGEST_SECRET, EMAIL_SCRIPT_URL], timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const action = String(request.data?.action || '');
    const role = await roleOf(request.auth);
    const allowed = action === 'setAuto' ? EMAIL_SETTING_ROLES : EMAIL_CHECK_ROLES;
    if (!['check', 'status', 'setAuto'].includes(action)) throw new HttpsError('invalid-argument', 'Unknown action.');
    if (!allowed.includes(role)) {
      throw new HttpsError('permission-denied',
        action === 'setAuto' ? 'Only director and superadmin can change this.' : 'Only supervisor and above can check email.');
    }

    let res, body;
    try {
      res = await fetch(EMAIL_SCRIPT_URL.value(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: INGEST_SECRET.value(), action, auto: !!request.data?.auto,
          by: request.auth.token?.email || '' }),
        redirect: 'follow',
      });
      const txt = await res.text();
      try { body = JSON.parse(txt); } catch { body = null; }
      if (!body) throw new Error(`mailbox script replied ${res.status} (not JSON) — is the web app deployed with access "Anyone"?`);
    } catch (e) {
      console.error('emailIntakeControl:', e);
      throw new HttpsError('unavailable', `Could not reach the mailbox script: ${e.message}`);
    }
    if (body.error) throw new HttpsError('failed-precondition', body.error);
    return body;
  });
