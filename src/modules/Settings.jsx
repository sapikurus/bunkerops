import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { T, s } from '../tokens';
import { COL } from '../config';
import { setCounterSeed } from './counters';

const currentYear = new Date().getFullYear();

export default function Settings() {
  const [year, setYear]   = useState(currentYear);
  const [doVal, setDoVal] = useState(null);
  const [bastVal, setBastVal] = useState(null);
  const [doSeed, setDoSeed]   = useState('');
  const [bastSeed, setBastSeed] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const doSnap = await getDoc(doc(db, COL.counters, `do_${year}`));
    const baSnap = await getDoc(doc(db, COL.counters, `bast_${year}`));
    setDoVal(doSnap.exists() ? doSnap.data().value : 0);
    setBastVal(baSnap.exists() ? baSnap.data().value : 0);
  };
  useEffect(() => { load(); }, [year]);

  // "Start at N" means the NEXT allocated number is N, so the stored counter = N-1.
  const applySeed = async (kind, startAt, currentValue) => {
    const n = parseInt(startAt, 10);
    if (isNaN(n) || n < 1) { setMsg('Enter a valid starting number (≥ 1).'); return; }
    const seed = n - 1;
    if (currentValue && seed < currentValue) {
      if (!confirm(`Current ${kind.toUpperCase()} counter is at ${currentValue} (next would be ${currentValue + 1}). ` +
        `Setting start to ${n} means next allocated = ${n}, which is BELOW or AT an already-issued number. ` +
        `This risks duplicate numbers. Proceed anyway?`)) return;
    }
    await setCounterSeed(kind, year, seed);
    setMsg(`${kind.toUpperCase()} ${year}: next number will be ${n}.`);
    load();
  };

  return (
    <div style={{ padding: 40, maxWidth: 640 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5 }}>SETTINGS — DOCUMENT NUMBERING</div>
        <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
          Set the starting number for a year's DO / BAST sequence (e.g. to align with existing paper records).
          Counters auto-increment from there and never reuse a number.
        </div>
      </div>

      <div style={{ ...s.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
          <div>
            <label style={s.label}>Year</label>
            <select style={{ ...s.input, width: 120 }} value={year} onChange={e => setYear(+e.target.value)}>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* DO seed */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>Delivery Orders (DO)</div>
          <div style={{ fontSize: 11, color: T.textDim, marginBottom: 10 }}>
            Current counter: <span style={{ color: T.amber }}>{doVal ?? '…'}</span>
            {doVal != null && <span> · next allocated: {doVal + 1}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <label style={s.label}>Start next DO at</label>
              <input style={{ ...s.input, width: 140 }} type="number" value={doSeed}
                onChange={e => setDoSeed(e.target.value)} placeholder="e.g. 42" />
            </div>
            <button onClick={() => applySeed('do', doSeed, doVal)} style={s.btn('primary')}>SET DO SEED</button>
          </div>
        </div>

        {/* BAST seed */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>BAST</div>
          <div style={{ fontSize: 11, color: T.textDim, marginBottom: 10 }}>
            Current counter: <span style={{ color: T.amber }}>{bastVal ?? '…'}</span>
            {bastVal != null && <span> · next allocated: {bastVal + 1}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <label style={s.label}>Start next BAST at</label>
              <input style={{ ...s.input, width: 140 }} type="number" value={bastSeed}
                onChange={e => setBastSeed(e.target.value)} placeholder="e.g. 3" />
            </div>
            <button onClick={() => applySeed('bast', bastSeed, bastVal)} style={s.btn('primary')}>SET BAST SEED</button>
          </div>
        </div>

        {msg && <div style={{ marginTop: 16, fontSize: 11, color: T.green }}>{msg}</div>}
      </div>

      <div style={{ fontSize: 10, color: T.textFaint, lineHeight: 1.6 }}>
        Note: seeds are per year. Each new year starts fresh at 1 unless you set a seed.
        Setting a seed below an already-issued number is blocked with a warning to prevent duplicate document numbers.
      </div>
    </div>
  );
}
