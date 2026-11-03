import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { BrandMark } from './AuthLayout.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { MANAGER_ROLES, roleLabel } from '../auth/roles.js';

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canManage = MANAGER_ROLES.includes(user.role);
  const isSuperAdmin = user.role === 'super_admin';

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={30} />
          <span>PCDS LRC</span>
        </div>
        <nav aria-label="Main">
          <NavLink to="/dashboard">Dashboard</NavLink>
          {canManage && <NavLink to="/statistics">Statistics</NavLink>}
          {canManage && <NavLink to="/students">Students</NavLink>}
          {isSuperAdmin && <NavLink to="/audit-logs">Audit Logs</NavLink>}
          {canManage && (
            <a href="/kiosk" target="_blank" rel="noopener noreferrer" className="nav-external">
              Kiosk
              <svg className="nav-external-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M6.5 3H13v6.5M13 3 5.5 10.5M11 13H3V5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </nav>
        <div className="user-pill" role="group" aria-label="Account">
          <ThemeToggle />
          <span className="user-name">{user.fullName}</span>
          <span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span>
          <button type="button" className="user-signout" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
