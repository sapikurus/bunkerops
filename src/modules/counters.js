import { db } from '../firebase';
import { doc, runTransaction } from 'firebase/firestore';
import { COL } from '../config';

// Atomically allocate the next sequence number for a document type in a given year.
// Uses a Firestore transaction so concurrent issuance can't produce duplicate or
// skipped numbers. Counter docs live in bunkerops_counters, keyed `${kind}_${year}`
// (e.g. 'do_2026', 'bast_2026'). A new year starts fresh at 1 automatically.
export async function allocateNumber(kind, year) {
  const ref = doc(db, COL.counters, `${kind}_${year}`);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data().value || 0) : 0;
    const value = current + 1;
    tx.set(ref, { kind, year, value }, { merge: true });
    return value;
  });
  return next;
}
