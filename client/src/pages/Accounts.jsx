import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Pagination from '../components/Pagination.jsx';
import { confirmDelete } from '../confirm.js';
import { showErrorToast, showSuccessToast } from '../toast.js';
import { roleLabel } from '../auth/roles.js';
import { validateNewAccount } from '../validation.js';

const ROLES = [
  { value: 'admin', label: 'Admin', id: 'AD-0000' },
  { value: 'student_assistant', label: 'Student Assistant', id: 'SA-0000' },
];
const ROLE_NAME = { admin: 'Admin', student_assistant: 'Student Assistant' };
const number = new Intl.NumberFormat('en-US');
const stamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const EMPTY = { fullName: '', email: '', role: '', password: '', confirmPassword: '' };

function CreateAccountForm({ onCreated, onClose }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const found = validateNewAccount(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const data = await api('/accounts', { method: 'POST', body: values });
      onCreated(data.account);
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="modal-note">
        The account can sign in right away. Its ID is assigned from the role ({ROLES.map((r) => r.id.replace('0000', '0001')).join(' or ')}). Give the
        person their ID or email and password.
      </p>
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}
      <Field label="Full name" name="fullName" autoComplete="off" value={values.fullName} onChange={set('fullName')} error={errors.fullName} />
      <Field label="Email" name="email" type="email" autoComplete="off" value={values.email} onChange={set('email')} error={errors.email} />
      <div className={`field${errors.role ? ' has-error' : ''}`}>
        <label htmlFor="acct-role">Role</label>
        <select
          id="acct-role"
          className="field-select"
          value={values.role}
          onChange={set('role')}
          aria-invalid={errors.role ? 'true' : undefined}
          aria-describedby={errors.role ? 'acct-role-err' : undefined}
        >
          <option value="">Choose a role</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {errors.role && (
          <p className="error-text" id="acct-role-err">
            {errors.role}
          </p>
        )}
      </div>
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with uppercase, lowercase and a number."
        value={values.password}
        onChange={set('password')}
        error={errors.password}
      />
      <Field
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={set('confirmPassword')}
        error={errors.confirmPassword}
      />
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  );
}

export default function Accounts() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set('q', q);
    if (role) qs.set('role', role);
    if (status) qs.set('status', status);
    try {
      const result = await api(`/accounts?${qs}`);
      setData(result);
      setError('');
      if (result.page !== page) setPage(result.page);
    } catch (err) {
      setError(err.message);
    }
  }, [q, role, status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(a, next) {
    if (next === 'inactive') {
      const ok = await confirmDelete({
        title: 'Deactivate this account?',
        text: `${a.fullName} (${a.memberId}) will be signed out and cannot sign in until the account is reactivated.`,
        confirmText: 'Deactivate',
      });
      if (!ok) return;
    }
    setBusyId(a.id);
    try {
      await api(`/accounts/${a.id}/${next === 'inactive' ? 'deactivate' : 'reactivate'}`, { method: 'POST' });
      showSuccessToast(next === 'inactive' ? 'Account deactivated' : 'Account reactivated', `${a.fullName} (${a.memberId})`);
      await load();
    } catch (err) {
      showErrorToast('Could not update the account', err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a) {
    const ok = await confirmDelete({
      title: 'Delete this account?',
      text: `${a.fullName} (${a.memberId}) will be removed permanently and signed out. Audit log entries keep their name. To only stop them signing in, deactivate the account instead.`,
      confirmText: 'Delete account',
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      await api(`/accounts/${a.id}`, { method: 'DELETE' });
      showSuccessToast('Account deleted', `${a.fullName} (${a.memberId})`);
      await load();
    } catch (err) {
      showErrorToast('Could not delete the account', err.message);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = Boolean(q || role);
  return (
    <div className="stats accounts">
      <header className="stats-head accounts-head">
        <div>
          <h1>Account Management</h1>
          <p className="lead">Admin and Student Assistant accounts.</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
          Create account
        </button>
      </header>

      {data && (
        <dl className="import-summary account-counts">
          <div className={data.counts.admins ? '' : 'is-zero'}>
            <dt>Active admins</dt>
            <dd>{number.format(data.counts.admins)}</dd>
          </div>
          <div className={data.counts.assistants ? '' : 'is-zero'}>
            <dt>Active student assistants</dt>
            <dd>{number.format(data.counts.assistants)}</dd>
          </div>
          <div className={data.counts.inactive ? '' : 'is-zero'}>
            <dt>Deactivated</dt>
            <dd>{number.format(data.counts.inactive)}</dd>
          </div>
        </dl>
      )}

      <section className="panel table-panel" aria-labelledby="accounts-h">
        <div className="table-head">
          <div>
            <h2 id="accounts-h">Accounts</h2>
            {data && (
              <p className="muted">
                {number.format(data.total)} {data.total === 1 ? 'account' : 'accounts'}
                {filtered ? ' found' : ''}
              </p>
            )}
          </div>
          <div className="account-filters">
            <div className="filter">
              <label htmlFor="acct-status">Status</label>
              <select id="acct-status" className="field-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="active">Active</option>
                <option value="inactive">Deactivated</option>
                <option value="">All</option>
              </select>
            </div>
            <div className="filter">
              <label htmlFor="acct-role-filter">Role</label>
              <select id="acct-role-filter" className="field-select" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter account-search">
              <label htmlFor="acct-search">Search</label>
              <input id="acct-search" type="search" className="field-select" placeholder="Name, email or ID" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {!data && !error && <p className="muted pad">Loading accounts…</p>}
        {data && data.accounts.length === 0 && (
          <p className="empty">
            {filtered ? 'No accounts match your search.' : status === 'inactive' ? 'No deactivated accounts.' : 'No accounts yet. Create one with Create account.'}
          </p>
        )}
        {data && data.accounts.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table accounts-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">ID</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id} className={a.status === 'active' ? '' : 'is-inactive'}>
                    <td>
                      <span className="strong">{a.fullName}</span>
                      <span className="muted account-email">{a.email}</span>
                    </td>
                    <td>{a.memberId}</td>
                    <td>
                      <span className={`role-badge role-${a.role}`}>{ROLE_NAME[a.role] || roleLabel(a.role)}</span>
                    </td>
                    <td>
                      <span className={`status ${a.status === 'active' ? 'status-in' : 'status-out'}`}>{a.status === 'active' ? 'Active' : 'Deactivated'}</span>
                    </td>
                    <td className="muted">{a.lastLoginAt ? stamp.format(new Date(a.lastLoginAt)) : 'Never'}</td>
                    <td>
                      <div className="account-actions">
                        {a.status === 'active' ? (
                          <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === a.id} onClick={() => changeStatus(a, 'inactive')}>
                            Deactivate
                          </button>
                        ) : (
                          <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === a.id} onClick={() => changeStatus(a, 'active')}>
                            Reactivate
                          </button>
                        )}
                        <button type="button" className="btn btn-danger btn-sm" disabled={busyId === a.id} onClick={() => remove(a)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pagination
            label="Account pages"
            page={data.page}
            totalPages={data.totalPages}
            pageSize={data.pageSize}
            total={data.total}
            nouns={['account', 'accounts']}
            onPage={(p) => setPage(Math.min(Math.max(p, 1), data.totalPages))}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        )}
      </section>

      {creating && (
        <Modal title="Create account" onClose={() => setCreating(false)}>
          <CreateAccountForm
            onClose={() => setCreating(false)}
            onCreated={(a) => {
              setCreating(false);
              showSuccessToast('Account created', `${a.fullName}: ${a.memberId}`);
              setStatus('active');
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
