import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './modules/AuthGate.jsx';
import Verify from './modules/Verify.jsx';
import './index.css';

// Lightweight routing: /verify/{docType}/{docId} shows the public verification
// page (no login). Everything else is the authenticated app.
function Root() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'verify' && parts[1] && parts[2]) {
    return <Verify docType={parts[1]} docId={parts[2]} />;
  }
  return <AuthGate><App /></AuthGate>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
