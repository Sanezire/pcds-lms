import { useAuth } from '../auth/AuthContext.jsx';
import ManualAttendance from '../components/ManualAttendance.jsx';
import MessageConfiguration from '../components/MessageConfiguration.jsx';

const ROLE_COPY = {
  admin: 'You have administrator access to the PCDS LRC.',
  librarian: 'You can run the PCDS LRC.',
  student: 'Your account is active. Kiosk features will appear here.',
};

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user.fullName.split(' ')[0];
  const canRecordAttendance = user.role === 'admin' || user.role === 'librarian';

  return (
    <div className="dashboard">
      <header className="dashboard-head">
        <h1>Welcome, {firstName}</h1>
        <p className="lead">{ROLE_COPY[user.role]}</p>
      </header>

      {canRecordAttendance && <ManualAttendance />}
      {canRecordAttendance && <MessageConfiguration />}
    </div>
  );
}
