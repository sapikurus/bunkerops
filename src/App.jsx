import { useState, useEffect } from 'react';
import { T } from './tokens';
import { APP_NAME } from './config';
import Nodes from './modules/Nodes';
import Clients from './modules/Clients';
import SalesRequests from './modules/SalesRequests';
import DeliveryOrders from './modules/DeliveryOrders';
import BASTModule from './modules/BASTModule';
import Settings from './modules/Settings';

const MODULES = [
  { key: 'nodes',    label: 'Storage Nodes',   icon: '⛴', ready: true },
  { key: 'clients',  label: 'Clients',         icon: '👥', ready: true },
  { key: 'sales',    label: 'Sales Requests',  icon: '📋', ready: true },
  { key: 'do',       label: 'Delivery Orders', icon: '📦', ready: true },
  { key: 'bast',     label: 'BAST',            icon: '📑', ready: true },
  { key: 'stock',    label: 'Stock Cards',     icon: '📊', ready: false },
  { key: 'settings', label: 'Settings',        icon: '⚙',  ready: true },
];

export default function App() {
  const [active, setActive] = useState('nodes');
  const [open, setOpen] = useState(false);      // mobile drawer open
  const [theme, setTheme] = useState('light');

  // apply theme to <html data-theme>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const renderModule = () => {
    switch (active) {
      case 'nodes':    return <Nodes />;
      case 'clients':  return <Clients />;
      case 'sales':    return <SalesRequests />;
      case 'do':       return <DeliveryOrders />;
      case 'bast':     return <BASTModule />;
      case 'settings': return <Settings />;
      default:
        return (
          <div style={{ color: T.textDim, padding: 40, fontSize: 13 }}>
            <div style={{ fontSize: 16, color: T.text, marginBottom: 8 }}>
              {MODULES.find(m => m.key === active)?.label}
            </div>
            Module not built yet.
          </div>
        );
    }
  };

  const pick = (key) => { setActive(key); setOpen(false); };

  const Sidebar = (
    <div style={{ width: 220, background: T.card, borderRight: `1px solid ${T.border}`,
      padding: '20px 0', flexShrink: 0, height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '0 20px 20px', borderBottom: `1px solid ${T.border}`, marginBottom: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.amber, letterSpacing: 1 }}>{APP_NAME}</div>
          <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginTop: 2 }}>OB GALLEY · BUNKER OPS</div>
        </div>
        <button onClick={() => setOpen(false)}
          style={{ display: 'none', background: 'none', border: 'none', color: T.textDim,
            fontSize: 20, cursor: 'pointer' }} className="mobile-only-close">×</button>
      </div>
      {MODULES.map(m => (
        <div key={m.key} onClick={() => pick(m.key)}
          style={{ padding: '11px 20px', cursor: 'pointer', fontSize: 12, display: 'flex',
            alignItems: 'center', gap: 10,
            color: active === m.key ? T.amber : (m.ready ? T.text : T.textFaint),
            background: active === m.key ? T.amberGlow : 'transparent',
            borderLeft: active === m.key ? `2px solid ${T.amber}` : '2px solid transparent' }}>
          <span style={{ width: 16, textAlign: 'center' }}>{m.icon}</span>
          <span>{m.label}</span>
          {!m.ready && <span style={{ marginLeft: 'auto', fontSize: 8, color: T.textFaint }}>soon</span>}
        </div>
      ))}
      {/* theme toggle */}
      <div style={{ padding: '16px 20px', marginTop: 12, borderTop: `1px solid ${T.border}` }}>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 3,
            color: T.textDim, fontSize: 11, padding: '6px 12px', cursor: 'pointer', width: '100%',
            fontFamily: T.font }}>
          {theme === 'light' ? '🌙 Dark mode' : '☀ Light mode'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>
      {/* Mobile top bar with hamburger */}
      <div className="mobile-topbar" style={{ display: 'none', alignItems: 'center', gap: 12,
        padding: '10px 16px', background: T.card, borderBottom: `1px solid ${T.border}` }}>
        <button onClick={() => setOpen(true)}
          style={{ background: 'none', border: 'none', color: T.text, fontSize: 22, cursor: 'pointer' }}>☰</button>
        <span style={{ color: T.amber, fontWeight: 700, letterSpacing: 1 }}>{APP_NAME}</span>
      </div>

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Desktop sidebar */}
        <div className="desktop-sidebar">{Sidebar}</div>

        {/* Mobile drawer + backdrop */}
        {open && (
          <>
            <div onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
            <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50 }} className="mobile-drawer">
              {Sidebar}
            </div>
          </>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>{renderModule()}</div>
      </div>

      <style>{`
        .desktop-sidebar { display: block; }
        .mobile-topbar { display: none !important; }
        @media (max-width: 768px) {
          .desktop-sidebar { display: none; }
          .mobile-topbar { display: flex !important; }
          .mobile-drawer .mobile-only-close { display: block !important; }
        }
      `}</style>
    </div>
  );
}
