import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { COL } from '../config';

// Public, read-only verification view reached via /verify/{docType}/{docId}.
// Shows ONLY minimal authenticity fields — never cost/margin data.
// Requires a Firestore rule allowing unauthenticated read of these two collections
// (scoped, single-doc). See firestore.rules note in the delivery message.

const TYPE_COL = {
  do:   COL.deliveryOrders,
  bast: COL.bast,
};

export default function Verify({ docType, docId }) {
  const [state, setState] = useState('loading'); // loading | found | notfound | error
  const [data, setData]   = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const colName = TYPE_COL[docType];
        if (!colName) { setState('notfound'); return; }
        const snap = await getDoc(doc(db, colName, docId));
        if (!snap.exists()) { setState('notfound'); return; }
        setData(snap.data());
        setState('found');
      } catch (e) {
        console.error(e);
        setState('error');
      }
    })();
  }, [docType, docId]);

  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', display: 'grid', placeItems: 'center',
      fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #d8dee7', borderRadius: 8,
        padding: 28, maxWidth: 460, width: '100%' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#c47f00', letterSpacing: 1 }}>bunkerops</div>
        <div style={{ fontSize: 10, color: '#97a4b4', letterSpacing: 1, marginBottom: 20 }}>DOCUMENT VERIFICATION</div>
        {children}
      </div>
    </div>
  );

  if (state === 'loading') return wrap(<div style={{ color: '#5a6b7f' }}>Verifying…</div>);
  if (state === 'notfound') return wrap(
    <div style={{ color: '#d13a4a', fontWeight: 600 }}>
      ✕ Not found. This document does not exist in the bunkerops system — it may be counterfeit.
    </div>
  );
  if (state === 'error') return wrap(<div style={{ color: '#d13a4a' }}>Verification error. Try again.</div>);

  // found
  const rows = docType === 'do'
    ? [
        ['Document', 'Delivery Order'],
        ['DO Number', data.brNo],
        ['Date', data.brDate],
        ['Deliver To', data.deliverTo],
        ['Location', data.deliverLocation],
        ['Vessel', data.vesselName],
        ['Dispatched Volume (L)', (Number(data.dispatchedVolumeL)||0).toLocaleString('id-ID')],
        ['Status', data.status],
      ]
    : [
        ['Document', 'BAST'],
        ['BAST Number', data.nomorBast],
        ['Date', data.tanggalBast],
        ['DO Reference', data.supplier?.deliveryOrder],
        ['Liter Standard @15°C', data.qty?.literStandard ? (Number(data.qty.literStandard)||0).toLocaleString('id-ID') : '—'],
        ['Status', data.status === 'blank' ? 'blank (pre-bunker)' : 'completed'],
      ];

  return wrap(
    <div>
      <div style={{ color: '#1f9d54', fontWeight: 700, marginBottom: 16 }}>✓ Authentic — found in bunkerops</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '6px 0', color: '#5a6b7f', width: '45%' }}>{k}</td>
              <td style={{ padding: '6px 0', color: '#1a2432', fontWeight: 500 }}>{v || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16, fontSize: 10, color: '#97a4b4', lineHeight: 1.5 }}>
        This confirms the document exists in the issuer's system with the details above.
        Compare against the printed copy — any discrepancy indicates tampering.
      </div>
    </div>
  );
}
