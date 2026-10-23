import { useAuth } from '../auth/AuthContext.jsx';

const ROLE_COPY = {
  admin: 'You have administrator access to the PCDS RFID Kiosk.',
  librarian: 'You can run the PCDS RFID Kiosk.',
  student: 'Your account is active. Kiosk features will appear here.',
};

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user.fullName.split(' ')[0];

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
    </div>
  );
}
