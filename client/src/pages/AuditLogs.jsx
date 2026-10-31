import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import Pagination from '../components/Pagination.jsx';
import { confirmDelete } from '../confirm.js';
import { showSuccessToast } from '../toast.js';
import { roleLabel } from '../auth/roles.js';

const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Failed sign-in',
  'account.register': 'Account registered',
  'attendance.time_in': 'Manual time in',
  'attendance.time_out': 'Manual time out',
  'attendance.edit': 'Attendance edited',
  'attendance.delete': 'Attendance deleted',
  'student.add': 'Student added',
  'student.import': 'Students imported',
  'message.rule_add': 'ID message added',
  'message.rule_edit': 'ID message edited',
  'message.rule_delete': 'ID message deleted',
  'message.broadcast': 'Kiosk message sent',
  'message.broadcast_delete': 'Kiosk message deleted',
  'message.pin': 'Kiosk message kept',
  'message.unpin': 'Kept message removed',
  'audit.delete': 'Audit logs deleted',
};
const CATEGORIES = [
  { value: '', label: 'All actions' },
  { value: 'auth', label: 'Sign-in and sign-out' },
  { value: 'account', label: 'Accounts' },
  { value: 'attendance', label: 'Manual attendance' },
  { value: 'student', label: 'Student records' },
  { value: 'message', label: 'Kiosk messages' },
  { value: 'audit', label: 'Audit log deletions' },
];
const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'student_assistant', label: 'SA' },
];
const EMPTY = { q: '', role: '', category: '', from: '', to: '' };
const TYPING_DELAY_MS = 300;
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export default function AuditLogs() {
  const [filters, setFilters] = useState(EMPTY);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const latest = useRef(0);
  const quiet = useRef(false);

  const rangeError = filters.from && filters.to && filters.from > filters.to ? 'The start date cannot be after the end date.' : '';

  // The search box waits for a short pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === term.trim() ? f : { ...f, q: term.trim() }));
      setPage(1);
    }, TYPING_DELAY_MS);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    if (rangeError) return;
    const id = ++latest.current;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    api(`/audit-logs?${qs}`)
      .then((r) => {
        if (id !== latest.current) return;
        // Deleting entries can leave this page past the end: step back to the last one.
        if (r.logs.length === 0 && r.total > 0 && page > 1) {
          setPage(Math.ceil(r.total / r.pageSize));
          return;
        }
        setData(r);
        setError('');
      })
      .catch((err) => id === latest.current && setError(err.message))
      .finally(() => id === latest.current && setLoading(false));
  }, [filters, page, pageSize, rangeError, refreshKey]);

  // New activity shows up without a refresh.
  useLiveReload(['audit'], useCallback(() => {
    quiet.current = true;
    setRefreshKey((k) => k + 1);
  }, []));

  const set = (name) => (e) => {
    setFilters((f) => ({ ...f, [name]: e.target.value }));
    setPage(1);
  };
  const reset = () => {
    setFilters(EMPTY);
    setTerm('');
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);

  const pageIds = data ? data.logs.map((l) => l.id) : [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
      return next;
    });

  async function runDelete(body, successTitle) {
    setDeleting(true);
    setError('');
    try {
      const result = await api('/audit-logs', { method: 'DELETE', body });
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
      showSuccessToast(successTitle, `${result.deleted} ${result.deleted === 1 ? 'entry' : 'entries'} removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelected() {
    const n = selected.size;
    const ok = await confirmDelete({
      title: `Delete ${n} audit log ${n === 1 ? 'entry' : 'entries'}?`,
      text: 'They will be permanently removed and cannot be restored.',
      confirmText: 'Delete selected',
    });
    if (ok) await runDelete({ ids: [...selected] }, 'Entries deleted');
  }

  async function deleteAll() {
    const ok = await confirmDelete({
      title: 'Delete all audit logs?',
      text: 'Every entry will be permanently removed, even ones hidden by the filters. This cannot be undone. One entry recording the deletion will remain.',
      confirmText: 'Delete all',
    });
    if (ok) await runDelete({ all: true }, 'Audit logs deleted');
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="stats">
      <header className="stats-head">
        <h1>Audit Logs</h1>
        <p className="lead">Every action by admins, student assistants and super admins, newest first.</p>
      </header>

      <form className="panel filters" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="filter-grid">
          <div className="filter">
            <label htmlFor="al-q">Search</label>
            <input id="al-q" type="search" className="field-select" placeholder="Name, ID or details" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="filter">
            <label htmlFor="al-role">Role</label>
            <select id="al-role" className="field-select" value={filters.role} onChange={set('role')}>
              {ROLE_FILTERS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="filter">
            <label htmlFor="al-cat">Action</label>
            <select id="al-cat" className="field-select" value={filters.category} onChange={set('category')}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="filter">
            <label htmlFor="al-from">From</label>
            <input id="al-from" type="date" className="field-select" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
          </div>
          <div className="filter">
            <label htmlFor="al-to">To</label>
            <input id="al-to" type="date" className="field-select" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
          </div>
        </div>
        <div className="filter-actions">
          <button type="button" className="btn btn-danger" onClick={deleteAll} disabled={deleting || (data && data.total === 0 && !filtered)}>
            Delete all logs
          </button>
          <button type="button" className="btn btn-quiet" onClick={reset} disabled={!filtered}>
            Reset filters
          </button>
        </div>
      </form>

      {(rangeError || error) && (
        <div className="alert alert-error" role="alert">{rangeError || error}</div>
      )}

      <section className="panel table-panel" aria-labelledby="audit-h" aria-busy={loading}>
        <div className="table-head">
          <h2 id="audit-h">Activity</h2>
          <div className="audit-bar">
            {selected.size > 0 && (
              <>
                <span className="audit-selected" role="status">{selected.size.toLocaleString()} selected</span>
                <button type="button" className="btn btn-quiet" onClick={() => setSelected(new Set())} disabled={deleting}>
                  Clear selection
                </button>
                <button type="button" className="btn btn-danger" onClick={deleteSelected} disabled={deleting}>
                  Delete selected
                </button>
              </>
            )}
            {data && (
              <p className="muted">
                {data.total.toLocaleString()} {data.total === 1 ? 'entry' : 'entries'}
              </p>
            )}
          </div>
        </div>
        {!data && loading && <p className="muted pad">Loading audit log…</p>}
        {data && data.logs.length === 0 && (
          <p className="empty">{filtered ? 'No entries match these filters.' : 'No activity has been recorded yet.'}</p>
        )}
        {data && data.logs.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table audit-table">
              <thead>
                <tr>
                  <th scope="col" className="audit-check">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPage && !allOnPage;
                      }}
                      onChange={togglePage}
                      aria-label="Select all entries on this page"
                    />
                  </th>
                  <th scope="col">Time</th>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Action</th>
                  <th scope="col">Details</th>
                  <th scope="col">IP address</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l) => (
                  <tr key={l.id} className={selected.has(l.id) ? 'is-selected' : undefined}>
                    <td className="audit-check">
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleOne(l.id)}
                        aria-label={`Select the entry from ${stamp.format(new Date(l.at))} by ${l.userName}`}
                      />
                    </td>
                    <td>{stamp.format(new Date(l.at))}</td>
                    <td>
                      <span className="strong">{l.userName}</span>
                      <span className="audit-id">{l.memberId}</span>
                    </td>
                    <td>
                      <span className={`role-badge role-${l.role}`}>{roleLabel(l.role)}</span>
                    </td>
                    <td>
                      <span className={`audit-action${l.action === 'auth.login_failed' ? ' is-warn' : ''}`}>
                        {ACTION_LABELS[l.action] || l.action}
                      </span>
                    </td>
                    <td className="audit-details">{l.details}</td>
                    <td>{l.ip || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pagination
            label="Audit log pages"
            page={data.page}
            totalPages={totalPages}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(p) => setPage(Math.min(Math.max(p, 1), totalPages))}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        )}
      </section>
    </div>
  );
}
