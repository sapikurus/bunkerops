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

