import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

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

export default function Statistics() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (filters) => {
    setLoading(true);
    try {
      const qs = buildParams(filters);
      const result = await api(`/statistics/attendance${qs ? `?${qs}` : ''}`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  const set = (name) => (e) => setDraft((d) => ({ ...d, [name]: e.target.value }));

  function onApply(e) {
    e.preventDefault();
    const problem = checkDuration(draft);
    setFormError(problem);
    if (!problem) setApplied(draft);
  }

  function onReset() {
    setDraft(EMPTY);
    setFormError('');
    setApplied(EMPTY);
  }

  const records = data?.records || [];
  const hidesRfid = Boolean(applied.course || applied.gender);

  return (
    <div className="stats">
      <header className="stats-head">
        <h1>Statistics</h1>
        <p className="lead">Attendance logs from the RFID kiosk and manual entries.</p>
      </header>

      <form className="panel filters" onSubmit={onApply} noValidate>
        <div className="filter-grid">
          <div className="filter">
            <label htmlFor="f-course">Course</label>
            <select id="f-course" className="field-select" value={draft.course} onChange={set('course')}>
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
            <select id="f-gender" className="field-select" value={draft.gender} onChange={set('gender')}>
              <option value="">All genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="filter">
            <label htmlFor="f-type">Type</label>
            <select id="f-type" className="field-select" value={draft.type} onChange={set('type')}>
              <option value="">RFID and manual</option>
              <option value="rfid">RFID</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="filter">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" className="field-select" value={draft.status} onChange={set('status')}>
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
            <NumberBox label="Minimum hours" value={draft.minH} onChange={set('minH')} max="9999" />
            <NumberBox label="Minimum minutes" value={draft.minM} onChange={set('minM')} max="59999" />
            <span className="duration-label">to</span>
            <NumberBox label="Maximum hours" value={draft.maxH} onChange={set('maxH')} max="9999" />
            <NumberBox label="Maximum minutes" value={draft.maxM} onChange={set('maxM')} max="59999" />
          </div>
          <p className="hint">Leave a side empty for no limit. Students still in are counted from Time In until now.</p>
        </fieldset>

        {formError && (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        )}

        <div className="filter-actions">
          <button type="button" className="btn btn-quiet btn-lg" onClick={onReset}>
            Reset
          </button>
          <button type="submit" className="btn btn-primary btn-lg">
            Apply filters
          </button>
        </div>
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
                      {formatDuration(r.durationMinutes)}
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
