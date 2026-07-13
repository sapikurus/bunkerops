import { useState, useEffect } from 'react';
import { T } from './tokens';
import { APP_NAME } from './config';
import { canAccess, ROLES } from './roles';
import SalesRequests from './modules/SalesRequests';
import DeliveryOrders from './modules/DeliveryOrders';
import BASTModule from './modules/BASTModule';
import StockCards from './modules/StockCards';
import Settings from './modules/Settings';

// Menu items with the capability each requires. Nodes/Clients now live inside Settings.
const MENU = [
  { key: 'sales',    label: 'Sales Requests',  icon: '📋', cap: 'salesOrder' },
  { key: 'do',       label: 'Delivery Orders', icon: '📦', cap: 'deliveryOrder' },
  { key: 'bast',     label: 'BAST',            icon: '📑', cap: 'bast' },
  { key: 'stock',    label: 'Stock Cards',     icon: '📊', cap: 'stockCards' },
  { key: 'settings', label: 'Settings',        icon: '⚙',  cap: null }, // shown if any settings sub-tab is allowed
];

export default function App({ user, role, signOut }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('light');

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Settings shows if the role can access any of its sub-areas.
  const canSettings = canAccess(role, 'generalSettings') || canAccess(role, 'masterData') || canAccess(role, 'usersRoles');
  const items = MENU.filter(m => m.key === 'settings' ? canSettings : canAccess(role, m.cap));

  const [active, setActive] = useState(items[0]?.key || 'do');

  const renderModule = () => {
    switch (active) {
      case 'sales':    return <SalesRequests role={role} />;
      case 'do':       return <DeliveryOrders role={role} />;
      case 'bast':     return <BASTModule role={role} />;
      case 'stock':    return <StockCards role={role} user={user} />;
      case 'settings': return <Settings role={role} />;
      default:
        return <div style={{ color: T.textDim, padding: 40 }}>Select a menu.</div>;
    }
  };

  const pick = (key) => { setActive(key); setOpen(false); };

  const Sidebar = (
    <div style={{ width: 220, background: T.card, borderRight: `1px solid ${T.border}`,
      padding: '20px 0', flexShrink: 0, height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '0 20px 16px', borderBottom: `1px solid ${T.border}`, marginBottom: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.amber, letterSpacing: 1 }}>{APP_NAME}</div>
          <div style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1, marginTop: 2 }}>OB GALLEY · BUNKER OPS</div>
        </div>
        <button onClick={() => setOpen(false)}
          style={{ display: 'none', background: 'none', border: 'none', color: T.textDim, fontSize: 20, cursor: 'pointer' }}
          className="mobile-only-close">×</button>
      </div>

      {/* current user + role */}
      <div style={{ padding: '0 20px 12px', fontSize: 10, color: T.textDim, lineHeight: 1.5 }}>
        <div style={{ color: T.text, wordBreak: 'break-all' }}>{user?.email}</div>
        <div style={{ color: T.amber, letterSpacing: 1, marginTop: 2 }}>{ROLES[role]?.label?.toUpperCase()}</div>
      </div>

      {items.map(m => (
        <div key={m.key} onClick={() => pick(m.key)}
          style={{ padding: '11px 20px', cursor: 'pointer', fontSize: 12, display: 'flex',
            alignItems: 'center', gap: 10,
            color: active === m.key ? T.amber : T.text,
            background: active === m.key ? T.amberGlow : 'transparent',
            borderLeft: active === m.key ? `2px solid ${T.amber}` : '2px solid transparent' }}>
          <span style={{ width: 16, textAlign: 'center' }}>{m.icon}</span>
          <span>{m.label}</span>
          {m.soon && <span style={{ marginLeft: 'auto', fontSize: 8, color: T.textFaint }}>soon</span>}
        </div>
      ))}

      <div style={{ padding: '16px 20px', marginTop: 12, borderTop: `1px solid ${T.border}` }}>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 3,
            color: T.textDim, fontSize: 11, padding: '6px 12px', cursor: 'pointer', width: '100%',
            fontFamily: T.font, marginBottom: 8 }}>
          {theme === 'light' ? '🌙 Dark mode' : '☀ Light mode'}
        </button>
        <button onClick={signOut}
          style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 3,
            color: T.textDim, fontSize: 11, padding: '6px 12px', cursor: 'pointer', width: '100%',
            fontFamily: T.font }}>
          SIGN OUT
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>
      <div className="mobile-topbar" style={{ display: 'none', alignItems: 'center', gap: 12,
        padding: '10px 16px', background: T.card, borderBottom: `1px solid ${T.border}` }}>
        <button onClick={() => setOpen(true)}
          style={{ background: 'none', border: 'none', color: T.text, fontSize: 22, cursor: 'pointer' }}>☰</button>
        <span style={{ color: T.amber, fontWeight: 700, letterSpacing: 1 }}>{APP_NAME}</span>
      </div>

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <div className="desktop-sidebar">{Sidebar}</div>

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
