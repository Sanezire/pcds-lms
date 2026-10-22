import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}

// Signed-in users only. Optionally limited to certain roles.
export function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

// Login and register pages: signed-in users are sent on to the dashboard.
export function GuestRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
