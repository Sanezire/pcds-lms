import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload, useNow } from '../live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ExportPanel from '../components/ExportPanel.jsx';

const EMPTY = {
  course: '',
  gender: '',
  type: '',
  status: '',
  minH: '',
  minM: '',
  maxH: '',
  maxM: '',
};

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatTime = (iso) => dateTime.format(new Date(iso));
const genderLabel = (g) => (g ? g.charAt(0).toUpperCase() + g.slice(1) : null);

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Turns the hour and minute boxes into total minutes. Blank means no limit.
function toMinutes(h, m) {
  if (h === '' && m === '') return null;
  return Number(h || 0) * 60 + Number(m || 0);
}

function buildParams(f) {
  const params = new URLSearchParams();
  for (const key of ['course', 'gender', 'type', 'status']) if (f[key]) params.set(key, f[key]);
  const min = toMinutes(f.minH, f.minM);
  const max = toMinutes(f.maxH, f.maxM);
  if (min !== null) params.set('minMinutes', String(min));
  if (max !== null) params.set('maxMinutes', String(max));
  return params.toString();
}

function checkDuration(f) {
  for (const key of ['minH', 'minM', 'maxH', 'maxM']) {
    if (f[key] !== '' && !/^\d{1,5}$/.test(f[key])) return 'Hours and minutes must be whole numbers.';
  }
  const min = toMinutes(f.minH, f.minM);
  const max = toMinutes(f.maxH, f.maxM);
  if (min !== null && max !== null && min > max) return 'The minimum time cannot be longer than the maximum.';
  return '';
}

function NumberBox({ label, value, onChange, max }) {
  return (
    <label className="num-box">
      <input
        type="number"
        inputMode="numeric"
        min="0"
        max={max}
        step="1"
        placeholder="0"
        value={value}
        onChange={onChange}
        aria-label={label}
      />
      <span>{label.endsWith('hours') ? 'h' : 'm'}</span>
    </label>
  );
}

// Typing in the hour and minute boxes waits this long after the last keystroke
// before asking the server, so each digit does not trigger its own request.
const TYPING_DELAY_MS = 300;

export default function Statistics() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latestRequest = useRef(0);
  const silentRef = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);

  const formError = checkDuration(filters);

  // Every filter change reloads the logs straight away. Invalid durations are
  // not sent, and a slow older response can never overwrite a newer one.
  useEffect(() => {
    if (formError) return undefined;

    const timer = setTimeout(async () => {
      const requestId = ++latestRequest.current;
      // Live refreshes swap the data in quietly; only filter changes show loading.
      const silent = silentRef.current;
      silentRef.current = false;
      if (!silent) setLoading(true);
      try {
        const qs = buildParams(filters);
        const result = await api(`/statistics/attendance${qs ? `?${qs}` : ''}`);
        if (requestId !== latestRequest.current) return;
        setData(result);
        if (result.serverTime) setServerOffset(new Date(result.serverTime).getTime() - Date.now());
        setError('');
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setError(err.message);
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    }, TYPING_DELAY_MS);

    return () => clearTimeout(timer);
  }, [filters, formError, refreshKey]);

  // New taps, manual entries and time-outs arrive here without a page refresh.
  useLiveReload(['attendance'], () => {
    silentRef.current = true;
    setRefreshKey((k) => k + 1);
  });

  // Visits that are still open keep counting up on their own between updates.
  const now = useNow(10000, serverOffset);
  const minutesFor = (r) =>
    r.active ? Math.max(Math.floor((now - new Date(r.timeIn).getTime()) / 60000), 0) : r.durationMinutes;

  const set = (name) => (e) => setFilters((f) => ({ ...f, [name]: e.target.value }));
  const onReset = () => setFilters(EMPTY);
  const isFiltered = Object.keys(EMPTY).some((k) => filters[k] !== '');

  const records = data?.records || [];
  const hidesRfid = Boolean(filters.course || filters.gender);

  return (
    <div className="stats">
      <header className="stats-head">
        <h1>Statistics</h1>
        <p className="lead">Attendance logs from the RFID kiosk and manual entries.</p>
      </header>

      {user.role === 'admin' && <ExportPanel />}

      <form className="panel filters" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="filter-grid">
          <div className="filter">
            <label htmlFor="f-course">Course</label>
            <select id="f-course" className="field-select" value={filters.course} onChange={set('course')}>
              <option value="">All courses</option>
              {(data?.options.courses || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="filter">
            <label htmlFor="f-gender">Gender</label>
            <select id="f-gender" className="field-select" value={filters.gender} onChange={set('gender')}>
              <option value="">All genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="filter">
            <label htmlFor="f-type">Type</label>
            <select id="f-type" className="field-select" value={filters.type} onChange={set('type')}>
              <option value="">RFID and manual</option>
              <option value="rfid">RFID</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="filter">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" className="field-select" value={filters.status} onChange={set('status')}>
              <option value="">All</option>
              <option value="out">Timed out</option>
              <option value="in">Still in</option>
            </select>
          </div>
        </div>

        <fieldset className="duration">
          <legend>Time spent</legend>
          <div className="duration-row">
            <span className="duration-label">From</span>
            <NumberBox label="Minimum hours" value={filters.minH} onChange={set('minH')} max="9999" />
            <NumberBox label="Minimum minutes" value={filters.minM} onChange={set('minM')} max="59999" />
            <span className="duration-label">to</span>
            <NumberBox label="Maximum hours" value={filters.maxH} onChange={set('maxH')} max="9999" />
            <NumberBox label="Maximum minutes" value={filters.maxM} onChange={set('maxM')} max="59999" />
            <button type="button" className="btn btn-quiet reset-btn" onClick={onReset} disabled={!isFiltered}>
              Reset filters
            </button>
          </div>
          <p className="hint">Leave a side empty for no limit. Students still in are counted from Time In until now.</p>
        </fieldset>

        {formError && (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        )}

      </form>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <section className="panel table-panel" aria-labelledby="logs-h" aria-busy={loading}>
        <div className="table-head">
          <h2 id="logs-h">Attendance logs</h2>
          {data && (
            <p className="muted" role="status">
              {data.limited
                ? `Showing the latest ${records.length} of ${data.total} records`
                : `${data.total} ${data.total === 1 ? 'record' : 'records'}`}
            </p>
          )}
        </div>

        {hidesRfid && (
          <p className="table-note">
            RFID records do not store a course or gender, so they are left out while those filters are on.
          </p>
        )}

        {!data && loading && <p className="muted pad">Loading logs…</p>}

        {data && records.length === 0 && <p className="empty">No attendance records match these filters.</p>}

        {records.length > 0 && (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Student ID</th>
                  <th scope="col">Course</th>
                  <th scope="col">Gender</th>
                  <th scope="col">Time In</th>
                  <th scope="col">Time Out</th>
                  <th scope="col">Total time</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.key}>
                    <td className="strong">{r.name}</td>
                    <td>{r.studentId}</td>
                    <td>{r.course || <span className="muted">Not recorded</span>}</td>
                    <td>{genderLabel(r.gender) || <span className="muted">Not recorded</span>}</td>
                    <td>{formatTime(r.timeIn)}</td>
                    <td>{r.timeOut ? formatTime(r.timeOut) : <span className="status status-in">Still in</span>}</td>
                    <td>
                      {formatDuration(minutesFor(r))}
                      {r.active && <span className="muted"> so far</span>}
                    </td>
                    <td>
                      <span className={`status ${r.type === 'rfid' ? 'status-out' : 'status-manual'}`}>
                        {r.type === 'rfid' ? 'RFID' : 'Manual'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
