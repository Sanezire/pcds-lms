import { useEffect, useRef, useState } from 'react';
import { api, download, ApiError, clearCachedAnswers } from '../api.js';
import { saveBlob } from '../reportDownload.js';
import { confirmDelete } from '../confirm.js';
import { showErrorToast, showSuccessToast } from '../toast.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const number = new Intl.NumberFormat('en-US');

function hourText(h) {
  if (h === 24) return '12:00 midnight';
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

function LibraryHours() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/settings/library-hours')
      .then((data) => {
        setSaved(data);
        setForm({ openHour: data.openHour, closeHour: data.closeHour, closedWeekdays: data.closedWeekdays });
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!form) {
    return error ? <div className="alert alert-error" role="alert">{error}</div> : <p className="muted">Loading…</p>;
  }

  const changed =
    form.openHour !== saved.openHour ||
    form.closeHour !== saved.closeHour ||
    form.closedWeekdays.join() !== saved.closedWeekdays.join();

  function toggleDay(d) {
    setForm((f) => ({
      ...f,
      closedWeekdays: f.closedWeekdays.includes(d) ? f.closedWeekdays.filter((x) => x !== d) : [...f.closedWeekdays, d].sort(),
    }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setErrors({});
    if (form.closeHour <= form.openHour) return setErrors({ closeHour: 'Closing time must be after opening time.' });
    if (form.closedWeekdays.length === 7) return setErrors({ closedWeekdays: 'The library has to be open on at least one day.' });
    setSaving(true);
    try {
      const data = await api('/settings/library-hours', { method: 'PATCH', body: form });
      setSaved(data);
      setForm({ openHour: data.openHour, closeHour: data.closeHour, closedWeekdays: data.closedWeekdays });
      clearCachedAnswers();
      showSuccessToast('Library hours saved', `${hourText(data.openHour)} to ${hourText(data.closeHour)}`);
    } catch (err) {
      setError(err.message);
      setErrors(err.fields || {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <p className="muted">
        The kiosk only accepts card taps while the library is open. Outside these hours a tap shows that the library
        is closed. A student still timed in at closing time is timed out automatically at the closing time. The hours
        are also used by the dashboard and the peak usage chart.
      </p>
      <p className="settings-status">
        <span className={`status ${saved.status.open ? 'status-in' : 'status-out'}`}>{saved.status.open ? 'Open now' : 'Closed now'}</span>
        <span className="muted">{saved.status.hours}</span>
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-hours">
        <div className="field">
          <label htmlFor="open-hour">Opening time</label>
          <select id="open-hour" className="field-select" value={form.openHour} onChange={(e) => setForm({ ...form, openHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourText(h)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="close-hour">Closing time</label>
          <select
            id="close-hour"
            className="field-select"
            value={form.closeHour}
            aria-invalid={Boolean(errors.closeHour)}
            aria-describedby={errors.closeHour ? 'close-hour-err' : undefined}
            onChange={(e) => setForm({ ...form, closeHour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{hourText(h)}</option>
            ))}
          </select>
          {errors.closeHour && <p id="close-hour-err" className="error-text">{errors.closeHour}</p>}
        </div>
      </div>
      <fieldset className="settings-days">
        <legend>Open days</legend>
        <div className="settings-day-list">
          {DAYS.map((name, d) => {
            const open = !form.closedWeekdays.includes(d);
            return (
              <button key={name} type="button" className={`day-chip${open ? ' is-on' : ''}`} aria-pressed={open} onClick={() => toggleDay(d)}>
                {name.slice(0, 3)}
                <span className="sr-only">{name}</span>
              </button>
            );
          })}
        </div>
        {errors.closedWeekdays && <p className="error-text">{errors.closedWeekdays}</p>}
      </fieldset>
      <div className="student-form-actions">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!changed || saving}
          onClick={() => setForm({ openHour: saved.openHour, closeHour: saved.closeHour, closedWeekdays: saved.closedWeekdays })}
        >
          Reset
        </button>
        <button type="submit" className="btn btn-primary" disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save hours'}
        </button>
      </div>
    </form>
  );
}

async function uploadBackup(file) {
  let res;
  try {
    res = await fetch('/api/settings/database/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'pcds-lms', 'Content-Type': 'application/sql' },
      body: file,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new ApiError(data?.error?.message || 'Something went wrong. Try again.', res.status);
  return data;
}

const TABLE_LABELS = {
  users: 'Accounts',
  students_data: 'Student records',
  attendance: 'Attendance visits',
  audit_logs: 'Audit log entries',
  message_rules: 'ID messages',
  kiosk_broadcasts: 'Kiosk messages',
  kiosk_pinned: 'Kept kiosk message',
  app_settings: 'Settings',
};

function DatabaseBackup() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function exportBackup() {
    setExporting(true);
    try {
      const { blob, filename } = await download('/settings/database/export');
      saveBlob(blob, filename);
      showSuccessToast('Backup downloaded', filename);
    } catch (err) {
      showErrorToast('Could not export', err.message);
    } finally {
      setExporting(false);
    }
  }

  function pick(e) {
    const f = e.target.files?.[0] || null;
    setError('');
    setResult(null);
    if (f && !/\.sql$/i.test(f.name)) {
      setFile(null);
      setError('Choose a .sql backup file.');
      return;
    }
    if (f && f.size > 200 * 1024 * 1024) {
      setFile(null);
      setError('That file is too large (over 200 MB).');
      return;
    }
    setFile(f);
  }

  function reset() {
    setFile(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function restore() {
    const ok = await confirmDelete({
      title: 'Restore this backup?',
      text: `Every account, student record, attendance visit, kiosk message, setting and audit log entry will be replaced with the contents of ${file.name}. This cannot be undone. Export a backup first if you may need the current data.`,
      confirmText: 'Restore backup',
    });
    if (!ok) return;
    setImporting(true);
    setError('');
    try {
      const data = await uploadBackup(file);
      setResult(data.counts);
      reset();
      clearCachedAnswers();
      showSuccessToast('Backup restored', file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="settings-backup">
      <div className="settings-block">
        <h3>Export</h3>
        <p className="muted">
          Download the whole database as a .sql file: accounts, student records, attendance, kiosk messages, settings
          and the audit log. Sign-ins are not included. The file holds everyone&apos;s data and the account password
          hashes, so keep it somewhere private.
        </p>
        <button type="button" className="btn btn-primary" onClick={exportBackup} disabled={exporting}>
          {exporting ? 'Preparing backup…' : 'Download backup'}
        </button>
      </div>

      <div className="settings-block">
        <h3>Import</h3>
        <p className="muted">
          Restore a backup made with Download backup. Everything currently in the database is replaced by the backup.
          If your own account is not in the backup, you are signed out.
        </p>
        <div className="student-import-pick">
          <label className="btn btn-quiet file-btn">
            <input ref={inputRef} type="file" accept=".sql,application/sql,text/plain" onChange={pick} />
            Choose backup file
          </label>
          {file && (
            <span className="muted file-name">
              {file.name} ({number.format(Math.ceil(file.size / 1024))} KB)
            </span>
          )}
        </div>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {file && (
          <div className="student-form-actions">
            <button type="button" className="btn btn-quiet" onClick={reset} disabled={importing}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-danger-solid" onClick={restore} disabled={importing}>
              {importing ? 'Restoring…' : 'Restore backup'}
            </button>
          </div>
        )}
        {result && (
          <div className="alert alert-success" role="status">
            Backup restored:{' '}
            {Object.entries(result)
              .map(([t, n]) => `${number.format(n)} ${(TABLE_LABELS[t] || t).toLowerCase()}`)
              .join(', ')}
            .
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="stats settings">
      <header className="stats-head">
        <h1>Settings</h1>
        <p className="lead">Library hours and database backups.</p>
      </header>
      <section className="panel" aria-labelledby="hours-h">
        <h2 id="hours-h">Library hours</h2>
        <LibraryHours />
      </section>
      <section className="panel" aria-labelledby="db-h">
        <h2 id="db-h">Database</h2>
        <DatabaseBackup />
      </section>
    </div>
  );
}
