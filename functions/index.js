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

  // Document deleted — leave DO/SO as-is (deletion is handled in the app, not here).
  if (!after) return;

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

    if (doData.status !== doTarget) {
      await doRef.update({ status: doTarget });
      console.log(`[${direction}] DO ${deliveryOrderId} → ${doTarget} (BAST ${bastId}).`);
    }

    const salesRequestId = doData.salesRequestId;
    if (salesRequestId) {
      const soRef = db.collection(COL.salesRequests).doc(salesRequestId);
      const soSnap = await soRef.get();
      if (soSnap.exists && soSnap.data().status !== soTarget) {
        await soRef.update({ status: soTarget });
        console.log(`[${direction}] SO ${salesRequestId} → ${soTarget}.`);
      }
    }
  } catch (err) {
    console.error(`onBastStatusChange (${direction}) failed for BAST ${bastId}:`, err);
    throw err; // retry on transient errors
  }
});
