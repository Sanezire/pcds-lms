import { useAuth } from '../auth/AuthContext.jsx';
import { MANAGER_ROLES } from '../auth/roles.js';
import { DashboardGreeting, SummaryTiles, useDashboardSummary } from '../components/DashboardSummary.jsx';
import ManualAttendance from '../components/ManualAttendance.jsx';
import MessageConfiguration from '../components/MessageConfiguration.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const summary = useDashboardSummary();
  const firstName = user.fullName.split(' ')[0];
  const canRecordAttendance = MANAGER_ROLES.includes(user.role) || user.role === 'student_assistant';
  const canManage = MANAGER_ROLES.includes(user.role);

  return (
    <div className="dashboard">
      <DashboardGreeting name={firstName} summary={summary} />
      <SummaryTiles summary={summary} />
      {canRecordAttendance && <ManualAttendance />}
      {canManage && <MessageConfiguration />}
    </div>
  );
}
