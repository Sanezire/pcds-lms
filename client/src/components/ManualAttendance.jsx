import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '../api.js';
import { Field } from './Field.jsx';
import Modal from './Modal.jsx';

const EMPTY = { name: '', studentId: '', course: '', gender: '' };
// Suggested in the Course box. Staff can still type any other course.
const COURSES = [
  'BS Nursing',
  'BS Hospitality Management',
  'BS Radiologic Technology',
  'BS Criminology',
  'BS Information Technology',
  'Diploma in Hotel and Restaurant Technology',
];
const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const formatTime = (iso) => (iso ? fmt.format(new Date(iso)) : '');
const genderLabel = (v) => GENDERS.find((g) => g.value === v)?.label || v;

function validate(v) {
  const e = {};
  const name = v.name.trim();
  const id = v.studentId.trim();
  if (name.length < 2) e.name = 'Enter the student’s full name.';
  if (!id) e.studentId = 'Enter the student ID.';
  else if (id.length < 3 || !/^[A-Za-z0-9][A-Za-z0-9_\-/]*$/.test(id))
    e.studentId = 'ID must be at least 3 characters: letters, numbers, hyphens, underscores or slashes.';
  if (v.course.trim().length < 2) e.course = 'Enter the course.';
  if (!v.gender) e.gender = 'Choose a gender.';
  return e;
}

function SelectField({ label, error, children, ...props }) {
  const id = useId();
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <select
          id={id}
          className="field-select"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          {...props}
        >
          {children}
        </select>
      </div>
      {error && (
        <p className="error-text" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

function NewEntryForm({ onSaved, onClose }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitting(true);
    try {
      const data = await api('/manual-attendance', { method: 'POST', body: values });
      onSaved(data.record);
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <p className="modal-note">For students without an RFID card. Time In is recorded when you submit.</p>
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}
      <Field label="Name" name="name" autoComplete="off" value={values.name} onChange={set('name')} error={errors.name} />
      <Field
        label="Student ID"
        name="studentId"
        autoComplete="off"
        value={values.studentId}
        onChange={set('studentId')}
        error={errors.studentId}
      />
      <Field
        label="Course"
        name="course"
        list="course-options"
        autoComplete="off"
        placeholder="Choose from the list or type a course"
        value={values.course}
        onChange={set('course')}
        error={errors.course}
      />
      <datalist id="course-options">
        {COURSES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <SelectField label="Gender" name="gender" value={values.gender} onChange={set('gender')} error={errors.gender}>
        <option value="">Select gender</option>
        {GENDERS.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </SelectField>
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
          {submitting ? 'Recording…' : 'Record Time In'}
        </button>
      </div>
    </form>
  );
}

function RecordDetails({ record, onTimedOut, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = !record.timeOut;

  async function timeOut() {
    setBusy(true);
    setError('');
    try {
      const data = await api(`/manual-attendance/${record.id}/time-out`, { method: 'POST' });
      onTimedOut(data.record);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <dl className="details modal-details">
        <div>
          <dt>Name</dt>
          <dd>{record.name}</dd>
        </div>
        <div>
          <dt>Student ID</dt>
          <dd>{record.studentId}</dd>
        </div>
        <div>
          <dt>Course</dt>
          <dd>{record.course}</dd>
        </div>
        <div>
          <dt>Gender</dt>
          <dd>{genderLabel(record.gender)}</dd>
        </div>
        <div>
          <dt>Time In</dt>
          <dd>{formatTime(record.timeIn)}</dd>
        </div>
        {!active && (
          <div>
            <dt>Time Out</dt>
            <dd>{formatTime(record.timeOut)}</dd>
          </div>
        )}
      </dl>
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
          Close
        </button>
        {active && (
          <button type="button" className="btn btn-primary btn-lg" onClick={timeOut} disabled={busy}>
            {busy ? 'Saving…' : 'Time Out'}
          </button>
        )}
      </div>
    </>
  );
}

export default function ManualAttendance() {
  const [records, setRecords] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null); // { type: 'new' } | { type: 'record', id }

  const load = useCallback(async () => {
    try {
      const data = await api('/manual-attendance');
      setRecords(data.records);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = modal?.type === 'record' ? records?.find((r) => r.id === modal.id) : null;
  const close = () => setModal(null);

  // Reload from the server so the list order and statuses always match the database.
  const saved = () => {
    close();
    load();
  };

  return (
    <section className="panel" aria-labelledby="manual-h">
      <div className="panel-head">
        <div>
          <h2 id="manual-h">Manual attendance</h2>
          <p className="muted">For students without an RFID card.</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setModal({ type: 'new' })}>
          Add student
        </button>
      </div>

      {loadError && (
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
      )}

      {!records && !loadError && <p className="muted">Loading records…</p>}

      {records && records.length === 0 && (
        <p className="empty">No manual entries yet. Add a student to record their Time In.</p>
      )}

      {records && records.length > 0 && (
        <ul className="record-list">
          {records.map((r) => (
            <li key={r.id}>
              <button type="button" className="record" onClick={() => setModal({ type: 'record', id: r.id })}>
                <span className="record-main">
                  <span className="record-name">{r.name}</span>
                  <span className="record-sub">
                    {r.studentId} · {r.course}
                  </span>
                </span>
                <span className="record-times">
                  <span>In {formatTime(r.timeIn)}</span>
                  {r.timeOut && <span>Out {formatTime(r.timeOut)}</span>}
                </span>
                <span className={`status ${r.timeOut ? 'status-out' : 'status-in'}`}>
                  {r.timeOut ? 'Timed out' : 'Timed in'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {modal?.type === 'new' && (
        <Modal title="Manual attendance" onClose={close}>
          <NewEntryForm onSaved={saved} onClose={close} />
        </Modal>
      )}
      {selected && (
        <Modal title="Attendance record" onClose={close}>
          <RecordDetails record={selected} onTimedOut={saved} onClose={close} />
        </Modal>
      )}
    </section>
  );
}
