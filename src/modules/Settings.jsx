import { useState, useEffect } from 'react';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { T, s } from '../tokens';
import { COL } from '../config';
import { setCounterSeed } from './counters';
import { canAccess, canManage } from '../roles';
import Nodes from './Nodes';
import Clients from './Clients';
import UsersRoles from './UsersRoles';
import { useIsNarrow } from './listUtils';

const currentYear = new Date().getFullYear();

// General Settings sub-view: document numbering seeds (+ room for more later).
function GeneralSettings() {
  const [year, setYear]   = useState(currentYear);
  const [doVal, setDoVal] = useState(null);
  const [bastVal, setBastVal] = useState(null);
  const [soVal, setSoVal] = useState(null);
  const [doSeed, setDoSeed]     = useState('');
  const [bastSeed, setBastSeed] = useState('');
  const [soSeed, setSoSeed]     = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const g = async (k) => { const s = await getDoc(doc(db, COL.counters, `${k}_${year}`)); return s.exists() ? s.data().value : 0; };
    setDoVal(await g('do')); setBastVal(await g('bast')); setSoVal(await g('so'));
  };
  useEffect(() => { load(); }, [year]);

  const applySeed = async (kind, startAt, currentValue) => {
    const n = parseInt(startAt, 10);
    if (isNaN(n) || n < 1) { setMsg('Enter a valid starting number (≥ 1).'); return; }
    const seed = n - 1;
    if (currentValue && seed < currentValue) {
      if (!confirm(`Current ${kind.toUpperCase()} counter is at ${currentValue} (next ${currentValue + 1}). ` +
        `Setting start to ${n} risks duplicate numbers. Proceed?`)) return;
    }
    await setCounterSeed(kind, year, seed);
    setMsg(`${kind.toUpperCase()} ${year}: next number will be ${n}.`);
    load();
  };

  const seedRow = (label, kind, val, seedVal, setSeedVal) => (
    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: T.textDim, marginBottom: 10 }}>
        Current counter: <span style={{ color: T.amber }}>{val ?? '…'}</span>
        {val != null && <span> · next: {val + 1}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div>
          <label style={s.label}>Start next at</label>
          <input style={{ ...s.input, width: 140 }} type="number" value={seedVal}
            onChange={e => setSeedVal(e.target.value)} placeholder="e.g. 1" />
        </div>
        <button onClick={() => applySeed(kind, seedVal, val)} style={s.btn('primary')}>SET</button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12, color: T.textDim, marginBottom: 16 }}>
        Document numbering seeds. Set the starting number for a year's sequence (e.g. to align with paper records).
      </div>
      <div style={{ ...s.card }}>
        <div style={{ marginBottom: 8 }}>
          <label style={s.label}>Year</label>
          <select style={{ ...s.input, width: 120 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {seedRow('Sales Orders (SO)', 'so', soVal, soSeed, setSoSeed)}
        {seedRow('Delivery Orders (DO)', 'do', doVal, doSeed, setDoSeed)}
        {seedRow('BAST', 'bast', bastVal, bastSeed, setBastSeed)}
        {msg && <div style={{ marginTop: 12, fontSize: 11, color: T.green }}>{msg}</div>}
      </div>
      <EmailIntakeSetting />
    </div>
  );
}

// Email intake: auto-check the mailbox every 10 minutes, or only on
// Sales Requests → 📧 CHECK EMAIL. The switch lives in the mailbox script.
function EmailIntakeSetting() {
  const [st, setSt]     = useState(null);   // { auto, lastRun, autoChanged, mailbox }
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const call = async (data) => {
    setBusy(true); setErr('');
    try { setSt((await httpsCallable(functions, 'emailIntakeControl')(data)).data); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { call({ action: 'status' }); }, []);
  const when = iso => (iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '');

  return (
    <div style={{ ...s.card, marginTop: 20 }}>
      <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>Email intake (Daidan PO emails)</div>
      <div style={{ fontSize: 11, color: T.textDim, marginBottom: 12, lineHeight: 1.6 }}>
        New Daidan PO emails become draft sales orders that a supervisor must approve.
        Off: drafts are made only when someone presses 📧 CHECK EMAIL on Sales Requests.
      </div>
      {st && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: T.text, cursor: busy ? 'wait' : 'pointer' }}>
          <input type="checkbox" checked={!!st.auto} disabled={busy}
            onChange={e => call({ action: 'setAuto', auto: e.target.checked })} />
          Check automatically every 10 minutes
          <span style={{ color: st.auto ? T.green : T.textDim, fontWeight: 700, fontSize: 11 }}>{st.auto ? 'ON' : 'OFF'}</span>
        </label>
      )}
      {!st && !err && <div style={{ fontSize: 11, color: T.textDim }}>Loading…</div>}
      {st && (
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 10, lineHeight: 1.7 }}>
          {st.mailbox && <div>Mailbox: {st.mailbox}</div>}
          {st.lastRun && <div>Last check: {when(st.lastRun.at)} ({st.lastRun.how}) · {st.lastRun.emails} email(s), {st.lastRun.created} draft(s)</div>}
          {st.autoChanged && <div>Switched {st.autoChanged.auto ? 'on' : 'off'} by {st.autoChanged.by} · {when(st.autoChanged.at)}</div>}
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: T.red, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

export default function Settings({ role }) {
  // Sub-tabs available to this role.
  const TABS = [
    { key: 'general', label: 'General Settings', show: canAccess(role, 'generalSettings') },
    { key: 'master',  label: 'Master Data',      show: canAccess(role, 'masterData') },
    { key: 'users',   label: 'Users & Roles',    show: canAccess(role, 'usersRoles') },
  ].filter(t => t.show);

  const [tab, setTab] = useState(TABS[0]?.key || 'general');
  const [masterView, setMasterView] = useState('nodes'); // nodes | clients
  const narrow = useIsNarrow();

  if (TABS.length === 0) {
    return <div style={{ padding: 40, color: T.textDim, fontSize: 13 }}>No settings available for your role.</div>;
  }

  return (
    <div style={{ padding: narrow ? 16 : 40, maxWidth: 1000 }}>
      <div style={{ fontSize: 11, color: T.amber, letterSpacing: 1.5, marginBottom: 16 }}>SETTINGS</div>

      {/* Sub-tab bar — horizontally scrollable on mobile so tabs never overflow */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${T.border}`,
        overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {TABS.map(t => (
          <div key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
              color: tab === t.key ? T.amber : T.textDim,
              borderBottom: tab === t.key ? `2px solid ${T.amber}` : '2px solid transparent',
              marginBottom: -1 }}>
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'general' && <GeneralSettings />}

      {tab === 'master' && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {[['nodes', 'Storage Nodes'], ['clients', 'Clients']].map(([k, lbl]) => (
              <button key={k} onClick={() => setMasterView(k)}
                style={{ ...s.btn(masterView === k ? 'primary' : 'ghost'), padding: '6px 14px', fontSize: 11 }}>
                {lbl}
              </button>
            ))}
          </div>
          {masterView === 'nodes' ? <Nodes embedded /> : <Clients embedded />}
        </div>
      )}

      {tab === 'users' && <UsersRoles role={role} />}
    </div>
  );
}
