import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import { Field } from './Field.jsx';
import IconButton from './IconButton.jsx';
import Modal from './Modal.jsx';
import { confirmDelete } from '../confirm.js';
import { showSuccessToast } from '../toast.js';

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

const PREVIEW_COUNT = 4;

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

function NewEntryForm({ record, onSaved, onClose }) {
  const [values, setValues] = useState(
    record ? { name: record.name, studentId: record.studentId, course: record.course, gender: record.gender } : EMPTY
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  // Fill the form from a student record. The fields stay editable.
  function fillFrom(student) {
    setValues({ name: student.name, studentId: student.studentId, course: student.course, gender: student.gender });
    setErrors({});
    setFormError('');
  }

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitting(true);
    try {
      const data = record
        ? await api(`/manual-attendance/${record.id}`, { method: 'PATCH', body: values })
        : await api('/manual-attendance', { method: 'POST', body: values });
      onSaved(data.record);
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <p className="modal-note">
        {record
          ? 'Update the student’s details. The recorded times stay the same.'
          : 'Search for the student to fill in their details, or type them in. Time In is recorded when you submit.'}
      </p>
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}
      {!record && <StudentSearch onPick={fillFrom} />}
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
          {submitting ? (record ? 'Saving…' : 'Recording…') : record ? 'Save changes' : 'Record Time In'}
        </button>
      </div>
    </form>
  );
}

// Looks students up in the student records. Choosing one fills in the form.
function StudentSearch({ onPick }) {
  const inputId = useId();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = term.trim();
    latest.current += 1;
    const ticket = latest.current;
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      setFailed(false);
      return undefined;
    }
    setSearching(true);
    // Wait for a pause in typing so each keystroke does not hit the server.
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/manual-attendance/students?q=${encodeURIComponent(q)}`);
        if (ticket !== latest.current) return; // an older search finishing late
        setResults(data.students);
        setFailed(false);
      } catch {
        if (ticket !== latest.current) return;
        setResults(null);
        setFailed(true);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  function pick(student) {
    onPick(student);
    setTerm('');
  }

  return (
    <div className="field student-search">
      <label htmlFor={inputId}>Find a student</label>
      <div className="input-wrap">
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder="Search by name or student ID"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div className="student-results-status" role="status">
        {searching && <span className="muted">Searching…</span>}
        {!searching && failed && <span className="error-text">Search is unavailable. Fill in the details below instead.</span>}
        {!searching && !failed && results && results.length === 0 && (
          <span className="muted">No student found. You can fill in the details below instead.</span>
        )}
      </div>
      {!searching && results && results.length > 0 && (
        <ul className="student-results">
          {results.map((s) => (
            <li key={s.studentId}>
              <button type="button" className="student-result" onClick={() => pick(s)}>
                <span className="student-result-main">
                  <span className="record-name">{s.name}</span>
                  <span className="record-sub">
                    {s.studentId} · {s.course}
                  </span>
                </span>
                {s.timedIn && <span className="status status-in">Timed in</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordButton({ record: r, onClick }) {
  return (
    <button type="button" className="record" onClick={onClick}>
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
      <span className={`status ${r.timeOut ? 'status-out' : 'status-in'}`}>{r.timeOut ? 'Timed out' : 'Timed in'}</span>
    </button>
  );
}

// One entry: the record itself plus its Edit and Delete buttons.
function RecordRow({ record: r, busy, onOpen, onEdit, onDelete }) {
  return (
    <li className="record-row">
      <RecordButton record={r} onClick={onOpen} />
      <div className="record-actions">
        <IconButton kind="edit" label={`Edit ${r.name}`} onClick={onEdit} />
        <IconButton kind="delete" label={`Delete ${r.name}`} onClick={onDelete} disabled={busy} />
      </div>
    </li>
  );
}

// Every manual entry, with search and filters. Choosing one does the same as
// choosing an entry in the panel: it opens that record so staff can Time Out.
function AllRecords({ records, busyId, onSelect, onEdit, onDelete, onClose }) {
  const searchId = useId();
  const courseId = useId();
  const genderId = useId();
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [gender, setGender] = useState('');

  const courses = useMemo(() => [...new Set(records.map((r) => r.course))].sort((a, b) => a.localeCompare(b)), [records]);

  const term = search.trim().toLowerCase();
  const filtered = records.filter(
    (r) =>
      (!course || r.course === course) &&
      (!gender || r.gender === gender) &&
      (!term || r.name.toLowerCase().includes(term) || r.studentId.toLowerCase().includes(term))
  );
  const filtering = Boolean(term || course || gender);

  function clear() {
    setSearch('');
    setCourse('');
    setGender('');
  }

  return (
    <Modal title="All manual attendance" className="modal-wide" onClose={onClose}>
      <p className="modal-note">Select a student to view their record or record a Time Out.</p>
      <div className="all-filters">
        <div className="field all-search">
          <label htmlFor={searchId}>Search</label>
          <div className="input-wrap">
            <input
              id={searchId}
              type="search"
              autoComplete="off"
              placeholder="Name or student ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={courseId}>Course</label>
          <div className="input-wrap">
            <select id={courseId} className="field-select" value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={genderId}>Gender</label>
          <div className="input-wrap">
            <select id={genderId} className="field-select" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">All genders</option>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="all-summary" role="status">
        <span className="muted">
          Showing {filtered.length} of {records.length}
        </span>
        {filtering && (
          <button type="button" className="btn btn-quiet" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="empty">No students match your search.</p>
      ) : (
        <ul className="record-list all-list">
          {filtered.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              busy={busyId === r.id}
              onOpen={() => onSelect(r.id)}
              onEdit={() => onEdit(r.id)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
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
  const [modal, setModal] = useState(null); // { type: 'new' } | { type: 'record', id } | { type: 'edit', id }
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState(null);

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

  useLiveReload(['attendance'], load);

  const selected = modal?.type === 'record' ? records?.find((r) => r.id === modal.id) : null;
  const editing = modal?.type === 'edit' ? records?.find((r) => r.id === modal.id) : null;
  const close = () => setModal(null);

  // Reload from the server so the list order and statuses always match the database.
  const saved = (message) => (record) => {
    close();
    load();
    showSuccessToast(message, record?.name);
  };

  async function remove(r) {
    const ok = await confirmDelete({
      title: 'Delete this record?',
      text: `The attendance record for ${r.name} (${r.studentId}) will be permanently removed.`,
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api(`/manual-attendance/${r.id}`, { method: 'DELETE' });
      if (modal?.id === r.id) close();
      await load();
      showSuccessToast('Record deleted', r.name);
    } catch (err) {
      // Already gone (for example deleted on another screen): just refresh.
      if (err.status !== 404) setLoadError(err.message);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="manual-h">
      <div className="panel-head">
        <div>
          <h2 id="manual-h" className="title-with-icon">
            <img className="title-icon" src="/images/manual_attendance_icon.png" alt="" />
            Manual Attendance
          </h2>
          <p className="muted">For students without an RFID card.</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setModal({ type: 'new' })}>
          <img className="btn-icon" src="/images/add_student_icon.png" alt="" />
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
        <>
          <ul className="record-list">
            {records.slice(0, PREVIEW_COUNT).map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                busy={busyId === r.id}
                onOpen={() => setModal({ type: 'record', id: r.id })}
                onEdit={() => setModal({ type: 'edit', id: r.id })}
                onDelete={() => remove(r)}
              />
            ))}
          </ul>
          {records.length > PREVIEW_COUNT && (
            <div className="view-all">
              <button type="button" className="btn btn-quiet btn-lg" onClick={() => setShowAll(true)}>
                View all {records.length} students
              </button>
            </div>
          )}
        </>
      )}

      {showAll && records && (
        <AllRecords
          records={records}
          busyId={busyId}
          onSelect={(id) => setModal({ type: 'record', id })}
          onEdit={(id) => setModal({ type: 'edit', id })}
          onDelete={remove}
          onClose={() => setShowAll(false)}
        />
      )}
      {modal?.type === 'new' && (
        <Modal title="Manual Attendance" onClose={close}>
          <NewEntryForm onSaved={saved('Time In recorded')} onClose={close} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit attendance record" onClose={close}>
          <NewEntryForm record={editing} onSaved={saved('Record updated')} onClose={close} />
        </Modal>
      )}
      {selected && (
        <Modal title="Attendance record" onClose={close}>
          <RecordDetails record={selected} onTimedOut={saved('Time Out recorded')} onClose={close} />
        </Modal>
      )}
    </section>
  );
}
