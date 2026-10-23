import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { BrandMark } from './AuthLayout.jsx';

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canManage = user.role === 'admin' || user.role === 'librarian';

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={30} />
          <span>PCDS RFID Kiosk</span>
        </div>
        <nav aria-label="Main">
          <NavLink to="/dashboard">Dashboard</NavLink>
          {canManage && <NavLink to="/members">Members</NavLink>}
          {canManage && <NavLink to="/kiosk">Kiosk</NavLink>}
        </nav>
        <div className="topbar-user">
          <span className="user-name">{user.fullName}</span>
          <span className={`role-badge role-${user.role}`}>{user.role}</span>
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
