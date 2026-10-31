import { Navigate, Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute.jsx';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Kiosk from './pages/Kiosk.jsx';
import Statistics from './pages/Statistics.jsx';
import Students from './pages/Students.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import { MANAGER_ROLES, SUPER_ADMIN_ONLY } from './auth/roles.js';

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Student-facing kiosk screen. Separate from the admin pages: no sign-in, no admin shell. */}
      <Route path="/kiosk" element={<Kiosk />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route element={<ProtectedRoute roles={MANAGER_ROLES} />}>
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/students" element={<Students />} />
          </Route>
          <Route element={<ProtectedRoute roles={SUPER_ADMIN_ONLY} />}>
            <Route path="/audit-logs" element={<AuditLogs />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
