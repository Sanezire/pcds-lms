import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import LiveStats from '../components/LiveStats.jsx';
import { useLiveData } from '../live.js';

const STAFF_ROLES = ['admin', 'librarian'];

const ROLE_COPY = {
  admin: 'You can manage accounts, assign roles and suspend access.',
  librarian: 'You can view the list of registered accounts.',
  student: 'Your account is active. Kiosk features will appear here.',
};

// Keeps the account details live: a role or status change made by an admin
// shows up here immediately (or signs the person out if access was removed).
function LiveAccount({ refresh }) {
  useLiveData(['users'], refresh);
  return null;
}

export default function Dashboard() {
  const { user, refresh } = useAuth();
  const isStaff = STAFF_ROLES.includes(user.role);
  const firstName = user.fullName.split(' ')[0];
  const canManage = isStaff;

  return (
    <div className="dashboard">
      <header className="dashboard-head">
        <h1>Welcome, {firstName}</h1>
        <p className="lead">{ROLE_COPY[user.role]}</p>
      </header>

      <section className="panel" aria-labelledby="account-h">
        <h2 id="account-h">Your account</h2>
        <dl className="details">
          <div>
            <dt>Full name</dt>
            <dd>{user.fullName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>ID</dt>
            <dd>{user.memberId}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd className="capitalize">{user.role}</dd>
          </div>
        </dl>
      </section>

      {isStaff && <LiveAccount refresh={refresh} />}
      {isStaff && <LiveStats />}

      {canManage && (
        <nav className="tiles" aria-label="Quick actions">
          <Link to="/members" className="tile">
            <span className="tile-title">Accounts</span>
            <span className="tile-text">
              {user.role === 'admin' ? 'Manage roles and access' : 'View registered accounts'}
            </span>
          </Link>
        </nav>
      )}
    </div>
  );
}
