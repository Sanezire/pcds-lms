import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { BrandMark } from './AuthLayout.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { MANAGER_ROLES, roleLabel } from '../auth/roles.js';
import {
  AccountsIcon,
  AuditIcon,
  ChartIcon,
  DashboardIcon,
  ExternalIcon,
  KioskIcon,
  MenuIcon,
  MoonIcon,
  SettingsIcon,
  SignOutIcon,
  StudentsIcon,
  SunIcon,
} from './Icons.jsx';

// The super admin has the most screens, so they get a sidebar instead of the top bar.
// Add new super admin screens here.
const SIDEBAR_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/statistics', label: 'Statistics', Icon: ChartIcon },
  { to: '/students', label: 'Students', Icon: StudentsIcon },
  { to: '/accounts', label: 'Account Management', Icon: AccountsIcon },
  { to: '/audit-logs', label: 'Audit Logs', Icon: AuditIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const COLLAPSED_KEY = 'pcds-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function SidebarShell({ user, onLogout }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false); // small screens: the sidebar slides in
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === 'dark';

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* the choice just isn't remembered */
    }
  }, [collapsed]);

  // Going to another screen closes the drawer on small screens.
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const tip = (label) => (collapsed ? label : undefined);

  return (
    <div className={`shell shell-sidebar${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-drawer-open' : ''}`}>
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-head">
          {/* The school logo (the whole header) opens and closes the sidebar; on small screens it closes the menu. */}
          <button
            type="button"
            className="sidebar-brand"
            onClick={() => (drawerOpen ? setDrawerOpen(false) : setCollapsed((c) => !c))}
            aria-expanded={drawerOpen || !collapsed}
            aria-controls="app-sidebar"
            aria-label={drawerOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={drawerOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="sidebar-label">PCDS LRC</span>
            {/* Slides to the right edge when the sidebar opens, back to the middle when it closes. */}
            <span className="sidebar-brand-logo" aria-hidden="true">
              <BrandMark size={34} />
            </span>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {SIDEBAR_ITEMS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} title={tip(label)} aria-label={collapsed ? label : undefined}>
              <Icon />
              <span className="sidebar-label">{label}</span>
            </NavLink>
          ))}
          <a
            href="/kiosk"
            target="_blank"
            rel="noopener noreferrer"
            title={tip('Kiosk (opens in a new tab)')}
            aria-label={collapsed ? 'Kiosk (opens in a new tab)' : undefined}
          >
            <KioskIcon />
            <span className="sidebar-label">Kiosk</span>
            <ExternalIcon className="sidebar-external" width={14} height={14} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </nav>

        <div className="sidebar-foot" role="group" aria-label="Account">
          <div className="sidebar-user" title={tip(`${user.fullName} (${roleLabel(user.role)})`)}>
            <span className="sidebar-avatar" aria-hidden="true">
              {initials(user.fullName)}
            </span>
            <span className="sidebar-user-text sidebar-label">
              <span className="user-name">{user.fullName}</span>
              <span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span>
            </span>
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              className="sidebar-action"
              onClick={toggleTheme}
              title={tip(dark ? 'Light mode' : 'Dark mode')}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
              <span className="sidebar-label">{dark ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button type="button" className="sidebar-action sidebar-signout" onClick={onLogout} title={tip('Sign out')} aria-label="Sign out">
              <SignOutIcon />
              <span className="sidebar-label">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <div className="sidebar-main">
        <header className="mobile-bar">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <button type="button" className="sidebar-brand" onClick={() => setDrawerOpen(true)} aria-label="Open menu" tabIndex={-1}>
            <BrandMark size={28} />
            <span>PCDS LRC</span>
          </button>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canManage = MANAGER_ROLES.includes(user.role);
  const isSuperAdmin = user.role === 'super_admin';

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  if (isSuperAdmin) return <SidebarShell user={user} onLogout={onLogout} />;

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
