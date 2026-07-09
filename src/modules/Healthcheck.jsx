import { useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { T, s } from '../tokens';
import { COL } from '../config';

export default function Healthcheck() {
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState('');

  const run = async () => {
    setStatus('running'); setDetail('');
    try {
      const ref = await addDoc(collection(db, COL.healthcheck), {
        note: 'pipe test', at: serverTimestamp(),
      });
      const snap = await getDocs(collection(db, COL.healthcheck));
      setStatus('ok');
      setDetail(`Wrote doc ${ref.id}. Collection "${COL.healthcheck}" now holds ${snap.size} doc(s).`);
    } catch (e) {
      setStatus('fail');
      setDetail(`${e.code || 'error'}: ${e.message}`);
    }
  };

  const color = status === 'ok' ? T.green : status === 'fail' ? T.red : T.textDim;

  return (
    <div style={{ padding: 40, maxWidth: 640 }}>
      <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5, marginBottom: 6 }}>
        FIREBASE PIPE HEALTHCHECK
      </div>
      <div style={{ fontSize: 13, color: T.textDim, marginBottom: 24, lineHeight: 1.6 }}>
        Writes one document to the <code style={{ color: T.text }}>{COL.healthcheck}</code> collection
        in the shared <code style={{ color: T.text }}>fuelops-pps</code> Firestore, then reads it back.
        Green means every layer works: env vars, config, Firestore reachability, and rules permitting the write.
      </div>

      <button onClick={run} disabled={status === 'running'} style={s.btn('primary')}>
        {status === 'running' ? 'TESTING…' : 'RUN HEALTHCHECK'}
      </button>

      <div style={{
        marginTop: 20, padding: 16, borderRadius: 4,
        border: `1px solid ${color}44`, background: `${color}11`, minHeight: 24,
      }}>
        <span style={{ color, fontWeight: 700, letterSpacing: 1 }}>{status.toUpperCase()}</span>
        {detail && <div style={{ marginTop: 8, fontSize: 12, color: T.textDim, lineHeight: 1.5 }}>{detail}</div>}
      </div>

      {status === 'fail' && (
        <div style={{ marginTop: 16, fontSize: 11, color: T.textFaint, lineHeight: 1.6 }}>
          If this says <code>permission-denied</code>, the config is fine but Firestore rules block the write —
          that's the signal to set up bunkerops security rules next. Any other error is a wiring issue.
        </div>
      )}
    </div>
  );
}
