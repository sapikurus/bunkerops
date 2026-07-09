import { useState } from 'react';
import { T } from './tokens';
import { APP_NAME } from './config';
import Healthcheck from './modules/Healthcheck';
import Nodes from './modules/Nodes';
import Clients from './modules/Clients';
import SalesRequests from './modules/SalesRequests';

// Module registry. Real modules get wired in here as they're built.
const MODULES = [
  { key: 'healthcheck', label: 'Healthcheck',    icon: '✓', ready: true },
  { key: 'nodes',       label: 'Storage Nodes',  icon: '⛴', ready: true },
  { key: 'clients',     label: 'Clients',        icon: '👥', ready: true },
  { key: 'sales',       label: 'Sales Requests', icon: '📋', ready: true },
  { key: 'do',          label: 'Delivery Orders',icon: '📦', ready: false },
  { key: 'bast',        label: 'BAST',           icon: '📑', ready: false },
  { key: 'stock',       label: 'Stock Cards',    icon: '📊', ready: false },
];

export default function App() {
  const [active, setActive] = useState('healthcheck');

  const renderModule = () => {
    switch (active) {
      case 'healthcheck': return <Healthcheck />;
      case 'nodes':       return <Nodes />;
      case 'clients':     return <Clients />;
      case 'sales':       return <SalesRequests />;
      default:
        return (
          <div style={{ color: T.textDim, padding: 40, fontSize: 13 }}>
            <div style={{ fontSize: 16, color: T.text, marginBottom: 8 }}>
              {MODULES.find(m => m.key === active)?.label}
            </div>
            Module not built yet. This is a placeholder — we build it once the pipe is proven.
          </div>
        );
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: T.bg }}>
      {/* Sidebar */}
      <div style={{ width: 220, borderRight: `1px solid ${T.border}`, padding: '20px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 20px', borderBottom: `1px solid ${T.border}`, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.amber, letterSpacing: 1 }}>{APP_NAME}</div>
          <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginTop: 2 }}>
            OB GALLEY · BUNKER OPS
          </div>
        </div>
        {MODULES.map(m => (
          <div key={m.key} onClick={() => setActive(m.key)}
            style={{
              padding: '9px 20px', cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 10,
              color: active === m.key ? T.amber : (m.ready ? T.text : T.textFaint),
              background: active === m.key ? T.amberGlow : 'transparent',
              borderLeft: active === m.key ? `2px solid ${T.amber}` : '2px solid transparent',
            }}>
            <span style={{ width: 16, textAlign: 'center' }}>{m.icon}</span>
            <span>{m.label}</span>
            {!m.ready && <span style={{ marginLeft: 'auto', fontSize: 8, color: T.textFaint }}>soon</span>}
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderModule()}
      </div>
    </div>
  );
}
