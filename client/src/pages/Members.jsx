import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { useLiveData } from '../live.js';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Members() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/users');
      setUsers(data.users);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Loads now and again whenever accounts change anywhere, no refresh needed.
  useLiveData(['users'], load);

  async function update(id, change) {
    setBusyId(id);
    setError('');
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: change });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Members</h1>
      <p className="lead">
        {isAdmin
          ? 'Assign roles and suspend or reactivate accounts.'
          : 'Everyone registered with PCDS RFID Kiosk.'}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <section className="panel table-panel">
        {!users && !error && <p className="muted pad">Loading members…</p>}
        {users && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = u.id === user.id;
                  const locked = !isAdmin || self || busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td>{u.fullName}</td>
                      <td>{u.email}</td>
                      <td>{u.memberId}</td>
                      <td>
                        {isAdmin ? (
                          <select
                            aria-label={`Role for ${u.fullName}`}
                            value={u.role}
                            disabled={locked}
                            onChange={(e) => update(u.id, { role: e.target.value })}
                          >
                            <option value="student">Student</option>
                            <option value="librarian">Librarian</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span className="capitalize">{u.role}</span>
                        )}
                      </td>
                      <td>
                        {isAdmin ? (
                          <select
                            aria-label={`Status for ${u.fullName}`}
                            value={u.status}
                            disabled={locked}
                            onChange={(e) => update(u.id, { status: e.target.value })}
                          >
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                            <option value="pending">Pending</option>
                          </select>
                        ) : (
                          <span className="capitalize">{u.status}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
