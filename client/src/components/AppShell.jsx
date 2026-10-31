import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { BrandMark } from './AuthLayout.jsx';
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
          {canManage && <NavLink to="/kiosk">Kiosk</NavLink>}
          {isSuperAdmin && <NavLink to="/audit-logs">Audit Logs</NavLink>}
        </nav>
        <div className="topbar-user">
          <span className="user-name">{user.fullName}</span>
          <span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span>
          <button className="btn btn-quiet" onClick={onLogout}>
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
