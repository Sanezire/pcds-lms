import { Navigate, Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute.jsx';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Kiosk from './pages/Kiosk.jsx';
import Statistics from './pages/Statistics.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route path="/" element={<Navigate to="/kiosk" replace />} />

      {/* Student-facing kiosk screen. Runs under a signed-in staff session, without the admin shell. */}
      <Route element={<ProtectedRoute roles={['admin', 'librarian']} />}>
        <Route path="/kiosk" element={<Kiosk />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route element={<ProtectedRoute roles={['admin', 'librarian']} />}>
            <Route path="/statistics" element={<Statistics />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
