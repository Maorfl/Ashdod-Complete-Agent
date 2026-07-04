import { NavLink, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import Dashboard from './pages/Dashboard';
import Importers from './pages/Importers';
import Approvals from './pages/Approvals';
import { AgentFilterProvider, useAgentFilter, AGENTS } from './context/AgentFilterContext';
import { ToastProvider } from './components/Toasts';

function nav({ isActive }: { isActive: boolean }) {
  return isActive ? 'active' : '';
}

// בורר סוכן גלובלי — segmented control המשפיע על כל שלושת העמודים
function AgentSwitcher() {
  const { agent, setAgent } = useAgentFilter();
  return (
    <div className="agent-switch" role="group" aria-label="סינון לפי עמיל מכס">
      {AGENTS.map((a) => (
        <button
          key={a.key}
          className={'seg' + (agent === a.key ? ' active' : '')}
          onClick={() => setAgent(a.key)}
          aria-pressed={agent === a.key}
        >
          {a.name}
          {a.code && <span className="seg-code mono">{a.code}</span>}
        </button>
      ))}
    </div>
  );
}

function Shell() {
  const [ver, setVer] = useState<{ current: string; update_required: boolean } | null>(null);

  useEffect(() => {
    api.version().then((v) => setVer(v)).catch(() => setVer({ current: '1.0.0', update_required: false }));
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <b>סוכן כספי</b>
          <span className="route-tag">אשדוד ← חיפה</span>
        </div>
        <AgentSwitcher />
        <div className={'ver-pill' + (ver?.update_required ? ' stale' : '')}>
          <span className="dot" />
          {ver?.update_required ? `עדכון זמין · גרסה ${ver.current}` : `גרסה ${ver?.current ?? '…'}`}
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/importers" element={<Importers />} />
          <Route path="/approvals" element={<Approvals />} />
        </Routes>
      </main>

      <nav className="nav">
        <div className="grp">תפעול</div>
        <NavLink to="/" className={nav} end><span className="ic">▤</span> דשבורד מטענים</NavLink>
        <NavLink to="/approvals" className={nav}><span className="ic">✆</span> אישורי שליחה</NavLink>
        <div className="grp">נתונים</div>
        <NavLink to="/importers" className={nav}><span className="ic">▦</span> ניהול יבואנים</NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AgentFilterProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AgentFilterProvider>
  );
}
