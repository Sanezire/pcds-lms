import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import { Field } from './Field.jsx';
import IconButton from './IconButton.jsx';
import Modal from './Modal.jsx';
import Pagination from './Pagination.jsx';
import { formatMinutes } from '../durations.js';
import { confirmDelete } from '../confirm.js';
import { showSuccessToast } from '../toast.js';
import { YEAR_LEVELS, yearLabel } from '../yearLevels.js';

const EMPTY = { name: '', studentId: '', course: '', yearLevel: '', gender: '' };
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
const clockFmt = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const formatClock = (iso) => (iso ? clockFmt.format(new Date(iso)) : '–');
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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
  if (!v.yearLevel) e.yearLevel = 'Choose a year level.';
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
    record
      ? {
          name: record.name,
          studentId: record.studentId,
          course: record.course,
          yearLevel: record.yearLevel ? String(record.yearLevel) : '',
          gender: record.gender,
        }
      : EMPTY
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
    setValues({
      name: student.name,
      studentId: student.studentId,
      course: student.course,
      yearLevel: student.yearLevel ? String(student.yearLevel) : '',
      gender: student.gender,
    });
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
      <SelectField label="Year level" name="yearLevel" value={values.yearLevel} onChange={set('yearLevel')} error={errors.yearLevel}>
        <option value="">Select year level</option>
        {YEAR_LEVELS.map((y) => (
          <option key={y} value={y}>
            {yearLabel(y)}
          </option>
        ))}
      </SelectField>
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
                    {s.studentId} · {s.course} · {yearLabel(s.yearLevel)}
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
          <dt>Year level</dt>
          <dd>{record.yearLevel ? yearLabel(record.yearLevel) : 'Not recorded'}</dd>
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

const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'in', label: 'Timed in' },
  { value: 'out', label: 'Timed out' },
];

const dayBefore = (key) => new Date(new Date(`${key}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

function dayHeading(day, today) {
  if (day === today) return 'Today';
  if (day === dayBefore(today)) return 'Yesterday';
  return dayLong.format(new Date(`${day}T00:00:00Z`));
}

export function groupByDay(records) {
  const groups = [];
  for (const r of records) {
    const last = groups[groups.length - 1];
    if (last && last.day === r.day) last.records.push(r);
    else groups.push({ day: r.day, records: [r] });
  }
  return groups;
}

const stayOf = (r) => (r.timeOut ? formatMinutes((new Date(r.timeOut) - new Date(r.timeIn)) / 60000) : '–');

function RowMenu({ name, onDelete, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const item = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    item.current?.focus();
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className="row-menu"
      ref={wrap}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="icon-btn row-menu-trigger"
        aria-label={`More actions for ${name}`}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="4" cy="10" r="1.7" fill="currentColor" />
          <circle cx="10" cy="10" r="1.7" fill="currentColor" />
          <circle cx="16" cy="10" r="1.7" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <ul className="row-menu-list" role="menu">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={item}
              className="row-menu-item"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete…
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function Cell({ label, value, className }) {
  return (
    <span className={`cell ${className}`}>
      <span className="cell-label">{label}</span>
      <span className="cell-value">{value}</span>
    </span>
  );
}

export function EntryRow({ record: r, busy, onOpen, onEdit, onDelete }) {
  const inside = !r.timeOut;
  return (
    <li
      className="entry"
      onClick={(e) => {
        if (!e.target.closest('.entry-actions, .entry-name')) onOpen();
      }}
    >
      <div className="entry-student">
        <button type="button" className="entry-name" onClick={onOpen}>
          {r.name}
        </button>
        <span className="entry-sub">
          {r.studentId} · {r.course}
          {r.yearLevel ? ` · ${yearLabel(r.yearLevel)}` : ''}
        </span>
      </div>
      <Cell className="cell-in" label="In" value={formatClock(r.timeIn)} />
      <Cell className="cell-out" label="Out" value={formatClock(r.timeOut)} />
      <Cell className="cell-stay" label="Stay" value={stayOf(r)} />
      <span className="entry-state">
        <span className={`status ${inside ? 'status-in' : 'status-muted'}`}>{inside ? 'Timed in' : 'Timed out'}</span>
      </span>
      <div className="entry-actions">
        <IconButton kind="edit" label={`Edit ${r.name}`} onClick={onEdit} />
        <RowMenu name={r.name} onDelete={onDelete} disabled={busy} />
      </div>
    </li>
  );
}

export function EntryGroups({ groups, dayCounts, today, busyId, onOpen, onEdit, onDelete }) {
  return groups.map((g) => {
    const count = dayCounts[g.day] ?? g.records.length;
    return (
      <section className="entry-group" key={g.day} aria-labelledby={`entry-day-${g.day}`}>
        <h3 className="entry-day" id={`entry-day-${g.day}`}>
          <span>{dayHeading(g.day, today)}</span>
          <span className="entry-count">
            {count} {count === 1 ? 'entry' : 'entries'}
          </span>
        </h3>
        <ul className="entry-list">
          {g.records.map((r) => (
            <EntryRow
              key={r.id}
              record={r}
              busy={busyId === r.id}
              onOpen={() => onOpen(r.id)}
              onEdit={() => onEdit(r.id)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </ul>
      </section>
    );
  });
}

export default function ManualAttendance() {
  const searchId = useId();
  const dateId = useId();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null); // { type: 'new' } | { type: 'record', id } | { type: 'edit', id }
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [refreshKey, setRefreshKey] = useState(0);
  const latest = useRef(0);
  const quiet = useRef(false);
  const topRef = useRef(null);

  useEffect(() => {
    const next = search.trim();
    if (next === term) return undefined;
    const timer = setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, term]);

  useEffect(() => {
    const id = ++latest.current;
    const silent = quiet.current;
    quiet.current = false;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (term) qs.set('search', term);
    if (status !== 'all') qs.set('status', status);
    if (date) qs.set('date', date);
    api(`/manual-attendance?${qs}`)
      .then((r) => {
        if (id !== latest.current) return;
        setData(r);
        setLoadError('');
        if (r.page !== page) setPage(r.page);
      })
      .catch((err) => {
        if (id === latest.current && !silent) setLoadError(err.message);
      });
  }, [term, status, date, page, pageSize, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);
  useLiveReload(['attendance'], () => {
    quiet.current = true;
    reload();
  });

  const records = data?.records;
  const selected = modal?.type === 'record' ? records?.find((r) => r.id === modal.id) : null;
  const editing = modal?.type === 'edit' ? records?.find((r) => r.id === modal.id) : null;
  const close = () => setModal(null);
  const filtering = Boolean(term || status !== 'all' || date);

  const saved = (message) => (record) => {
    close();
    reload();
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
      reload();
      showSuccessToast('Record deleted', r.name);
    } catch (err) {
      if (err.status !== 404) setLoadError(err.message);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() {
    setSearch('');
    setTerm('');
    setStatus('all');
    setDate('');
    setPage(1);
  }

  function chooseStatus(value) {
    setStatus(value);
    setPage(1);
  }

  function goToPage(n) {
    setPage(n);
    topRef.current?.scrollIntoView({ block: 'start' });
  }

  return (
    <section className="panel" aria-labelledby="manual-h">
      <div className="panel-head" ref={topRef}>
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

      <div className="entry-bar">
        <div className="entry-filters">
          <div className="field entry-search">
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
          <div className="entry-status-filter" role="group" aria-label="Show entries">
            <span className="entry-filter-label" aria-hidden="true">
              Status
            </span>
            <div className="seg">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`seg-btn${status === s.value ? ' is-active' : ''}`}
                  aria-pressed={status === s.value}
                  onClick={() => chooseStatus(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field entry-date">
            <label htmlFor={dateId}>Date</label>
            <div className="input-wrap">
              <input
                id={dateId}
                type="date"
                value={date}
                max={data?.today}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          {filtering && (
            <button type="button" className="btn btn-quiet entry-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="entry-head" aria-hidden="true">
          <span>Student</span>
          <span>In</span>
          <span>Out</span>
          <span>Stay</span>
          <span>Status</span>
          <span />
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
      )}

      {!data && !loadError && <p className="muted">Loading records…</p>}

      {records && records.length === 0 && (
        <p className="empty">
          {filtering ? 'No entries match your search or filters.' : 'No manual entries yet. Add a student to record their Time In.'}
        </p>
      )}

      {records && records.length > 0 && (
        <>
          <EntryGroups
            groups={groupByDay(records)}
            dayCounts={data.dayCounts}
            today={data.today}
            busyId={busyId}
            onOpen={(id) => setModal({ type: 'record', id })}
            onEdit={(id) => setModal({ type: 'edit', id })}
            onDelete={remove}
          />
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            pageSize={data.pageSize}
            total={data.total}
            onPage={goToPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            label="Manual attendance pages"
            nouns={['entry', 'entries']}
          />
        </>
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
