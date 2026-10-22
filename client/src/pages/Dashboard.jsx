import { useAuth } from '../auth/AuthContext.jsx';

const ROLE_COPY = {
  admin: 'You can manage members, assign roles and suspend accounts.',
  librarian: 'You can view the member list and, soon, manage the catalogue and loans.',
  student: 'Catalogue search, reservations and your loans will appear here.',
};

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user.fullName.split(' ')[0];

  return (
    <>
      <h1>Welcome, {firstName}</h1>
      <p className="lead">{ROLE_COPY[user.role]}</p>

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
            <dt>Student/staff ID</dt>
            <dd>{user.memberId}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd className="capitalize">{user.role}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
