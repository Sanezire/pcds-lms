import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { Field } from './Field.jsx';
import { showErrorToast, showSuccessToast } from '../toast.js';
import Modal from './Modal.jsx';
import IconButton from './IconButton.jsx';
import { confirmDelete } from '../confirm.js';

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
const YEARS = [1, 2, 3, 4];
const EMPTY = { rfidNumber: '', studentId: '', fullName: '', course: '', gender: '', yearLevel: '' };
const TEMPLATE =
  'rfid_number,student_id,full_name,course,gender,year_level\r\n' +
  '3E5CCBF0,2025-1042-3,Maria Clara Santos,BS Information Technology,female,2\r\n' +
  ',2025-1043-1,Jose Andres Reyes,BS Nursing,male,1\r\n';
const MAX_FILE_BYTES = 900 * 1024;
const PAGE_SIZE = 25;
const number = new Intl.NumberFormat();
const genderLabel = (v) => GENDERS.find((g) => g.value === v)?.label || v;

function Select({ label, error, children, ...props }) {
  const id = useId();
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <select id={id} className="field-select" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined} {...props}>
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

function StudentFields({ values, errors, set, onFieldBlur, onSelectCommit, onRfidFocus, onRfidChange, onRfidKeyDown }) {
  const listId = useId();
  return (
    <div className="student-form-grid">
      <Field label="RFID number" name="rfidNumber" autoComplete="off" spellCheck="false" placeholder="e.g. 3E5CCBF0" value={values.rfidNumber} onChange={onRfidChange || set('rfidNumber')} onFocus={onRfidFocus} onKeyDown={onRfidKeyDown} onBlur={onFieldBlur} error={errors.rfidNumber} />
      <Field label="Student ID" name="studentId" autoComplete="off" placeholder="2025-1042-3" value={values.studentId} onChange={set('studentId')} onBlur={onFieldBlur} error={errors.studentId} />
      <Field label="Full name" name="fullName" autoComplete="off" value={values.fullName} onChange={set('fullName')} onBlur={onFieldBlur} error={errors.fullName} />
      <Field label="Course" name="course" list={listId} autoComplete="off" placeholder="Choose from the list or type a course" value={values.course} onChange={set('course')} onBlur={onFieldBlur} error={errors.course} />
      <datalist id={listId}>
        {COURSES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Select label="Gender" value={values.gender} onChange={(e) => { set('gender')(e); onSelectCommit?.({ gender: e.target.value }); }} error={errors.gender}>
        <option value="">Select gender</option>
        {GENDERS.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </Select>
      <Select label="Year level" value={values.yearLevel} onChange={(e) => { set('yearLevel')(e); onSelectCommit?.({ yearLevel: e.target.value }); }} error={errors.yearLevel}>
        <option value="">Select year level</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            Year {y}
          </option>
        ))}
      </Select>
    </div>
  );
}

function AddStudentForm({ onAdded }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: k === 'rfidNumber' ? e.target.value.toUpperCase() : e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api('/students', { method: 'POST', body: values });
      showSuccessToast('Student added');
      setValues(EMPTY);
      setErrors({});
      onAdded();
    } catch (err) {
      setErrors(err.fields || {});
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="student-form" onSubmit={submit} noValidate>
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}
      <StudentFields values={values} errors={errors} set={set} />
      <div className="student-form-actions">
        <button type="button" className="btn btn-quiet" onClick={() => { setValues(EMPTY); setErrors({}); setFormError(''); }}>
          Clear
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Adding…' : 'Add student'}
        </button>
      </div>
    </form>
  );
}

const SCAN_GAP_MS = 60;
const SCAN_IDLE_MS = 150;
const MIN_SCAN_LENGTH = 4;
const CLOSE_DELAY_MS = 500;

function toValues(student) {
  return {
    rfidNumber: student.rfidNumber || '',
    studentId: student.studentId,
    fullName: student.fullName,
    course: student.course,
    gender: student.gender,
    yearLevel: String(student.yearLevel),
  };
}

function StudentEditor({ student, closeRef, onSaved, onDelete, onClose }) {
  const [values, setValues] = useState(() => toValues(student));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState('');
  const valuesRef = useRef(values);
  const savedRef = useRef(JSON.stringify(toValues(student)));
  const failedRef = useRef('');
  const savingRef = useRef(false);
  const burst = useRef({ last: 0, fast: 0, timer: null });

  const update = (next) => {
    valuesRef.current = next;
    setValues(next);
  };
  const set = (k) => (e) => {
    update({ ...valuesRef.current, [k]: k === 'rfidNumber' ? e.target.value.toUpperCase() : e.target.value });
    setErrors((er) => ({ ...er, [k]: undefined }));
    setStatus('');
  };

  useEffect(() => () => clearTimeout(burst.current.timer), []);

  async function save(next = valuesRef.current, { scanned = false, closeAfter = false } = {}) {
    const snapshot = JSON.stringify(next);
    if (snapshot === savedRef.current && closeAfter && !savingRef.current) {
      onClose();
      return true;
    }
    if (snapshot === savedRef.current || snapshot === failedRef.current || savingRef.current) return true;
    savingRef.current = true;
    setFormError('');
    setStatus('Saving…');
    try {
      const r = await api(`/students/${student.id}`, { method: 'PATCH', body: next });
      savedRef.current = snapshot;
      failedRef.current = '';
      setErrors({});
      setStatus('Saved');
      if (scanned) showSuccessToast('RFID number saved', next.fullName);
      onSaved(r.student);
      if (closeAfter) setTimeout(onClose, CLOSE_DELAY_MS);
      return true;
    } catch (err) {
      failedRef.current = snapshot;
      setErrors(err.fields || {});
      setFormError(err.message);
      setStatus('');
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  function onRfidChange(e) {
    const value = e.target.value.toUpperCase();
    const next = { ...valuesRef.current, rfidNumber: value };
    update(next);
    setErrors((er) => ({ ...er, rfidNumber: undefined }));
    setStatus('');
    const now = performance.now();
    const b = burst.current;
    b.fast = now - b.last < SCAN_GAP_MS ? b.fast + 1 : 0;
    b.last = now;
    clearTimeout(b.timer);
    if (value.length >= MIN_SCAN_LENGTH && b.fast >= value.length - 1) {
      b.timer = setTimeout(() => save(valuesRef.current, { scanned: true, closeAfter: true }), SCAN_IDLE_MS);
    }
  }

  function onRfidKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(burst.current.timer);
      const v = valuesRef.current.rfidNumber;
      save(valuesRef.current, { scanned: v.length >= MIN_SCAN_LENGTH && burst.current.fast >= v.length - 1, closeAfter: true });
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target;
    const settled = JSON.parse(failedRef.current || savedRef.current).rfidNumber;
    if (el.value && el.value === settled && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      el.select();
    }
  }

  function commit(change) {
    update({ ...valuesRef.current, ...change });
    save();
  }

  async function close() {
    clearTimeout(burst.current.timer);
    await save();
    onClose();
  }

  closeRef.current = close;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.name !== 'rfidNumber') {
          e.preventDefault();
          save(valuesRef.current, { closeAfter: true });
        }
      }}
      noValidate
    >
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}
      <StudentFields
        values={values}
        errors={errors}
        set={set}
        onRfidChange={onRfidChange}
        onRfidFocus={(e) => e.target.select()}
        onRfidKeyDown={onRfidKeyDown}
        onFieldBlur={() => save()}
        onSelectCommit={commit}
      />
      <p className="muted student-save-status" role="status">
        {status || 'Tap a card to fill in the RFID number. It saves and closes on its own.'}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet btn-lg" onClick={close}>
          Close
        </button>
        <button type="button" className="btn btn-quiet btn-danger btn-lg" onClick={onDelete}>
          Delete
        </button>
      </div>
    </form>
  );
}

function ImportCsv({ onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null); // { name, text }
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function run(text, commit) {
    setBusy(true);
    setError('');
    try {
      const r = await api('/students/import', { method: 'POST', body: { csv: text, commit } });
      setResult(r);
      if (commit) {
        showSuccessToast(`${r.added} ${r.added === 1 ? 'student' : 'students'} imported`);
        onImported();
      }
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e) {
    const f = e.target.files?.[0];
    setResult(null);
    setError('');
    if (!f) return setFile(null);
    if (!/\.csv$/i.test(f.name)) {
      setFile(null);
      return setError('Choose a .csv file.');
    }
    if (f.size > MAX_FILE_BYTES) {
      setFile(null);
      return setError('That file is too large. Split it into smaller files (under 900 KB).');
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    run(text, false);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const done = result?.committed;
  return (
    <div className="student-import">
      <p className="muted">
        Upload a .csv file with the columns <code>student_id</code>, <code>full_name</code>, <code>course</code>,{' '}
        <code>gender</code> and <code>year_level</code>. The <code>rfid_number</code> column is optional: leave it out or
        leave a cell blank and the student is saved without a card. The file is checked first and nothing is saved until
        you confirm.
      </p>
      <div className="student-import-pick">
        <label className="btn btn-quiet file-btn">
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onPick} />
          Choose CSV file
        </label>
        <button type="button" className="btn btn-quiet" onClick={downloadTemplate}>
          Download template
        </button>
        {file && <span className="muted file-name">{file.name}</span>}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {busy && !result && <p className="muted">Checking file…</p>}

      {result && (
        <div className="import-result" aria-live="polite">
          {done ? (
            <div className="alert alert-success" role="status">
              Imported {number.format(result.added)} of {number.format(result.total)} rows.
              {result.problemCount > 0 && ` ${number.format(result.problemCount)} skipped.`}
            </div>
          ) : (
            <p role="status">
              <strong>{number.format(result.valid)}</strong> of {number.format(result.total)} rows are ready to import
              {result.problemCount > 0 && <>, <strong>{number.format(result.problemCount)}</strong> will be skipped</>}.
            </p>
          )}

          {!done && result.preview.length > 0 && (
            <div className="table-scroll">
              <table className="stats-table">
                <caption className="muted">First {result.preview.length} valid rows</caption>
                <thead>
                  <tr>
                    <th scope="col">RFID number</th>
                    <th scope="col">Student ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Course</th>
                    <th scope="col">Gender</th>
                    <th scope="col">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((r) => (
                    <tr key={r.studentId}>
                      <td>{r.rfidNumber || <span className="muted">Not assigned</span>}</td>
                      <td>{r.studentId}</td>
                      <td>{r.fullName}</td>
                      <td>{r.course}</td>
                      <td>{genderLabel(r.gender)}</td>
                      <td>{r.yearLevel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.problemCount > 0 && (
            <details className="import-problems" open={!done}>
              <summary>
                {number.format(result.problemCount)} {result.problemCount === 1 ? 'row' : 'rows'} skipped
              </summary>
              <ul>
                {result.problems.map((p) => (
                  <li key={p.line}>
                    <strong>Line {p.line}</strong>
                    {p.name ? ` (${p.name})` : ''}: {p.errors.join(' ')}
                  </li>
                ))}
              </ul>
              {result.problemCount > result.problems.length && (
                <p className="muted">Showing the first {result.problems.length}.</p>
              )}
            </details>
          )}

          <div className="student-form-actions">
            <button type="button" className="btn btn-quiet" onClick={reset}>
              {done ? 'Import another file' : 'Cancel'}
            </button>
            {!done && (
              <button type="button" className="btn btn-primary" disabled={busy || result.valid === 0} onClick={() => run(file.text, true)}>
                {busy ? 'Importing…' : `Import ${number.format(result.valid)} ${result.valid === 1 ? 'student' : 'students'}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StudentList({ refreshKey }) {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [course, setCourse] = useState('');
  const [courses, setCourses] = useState([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const editorClose = useRef(null);
  const latest = useRef(0);

  // Search waits for a short pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const r = await api(`/students?q=${encodeURIComponent(q)}&course=${encodeURIComponent(course)}&page=${page}&pageSize=${PAGE_SIZE}`);
      if (id !== latest.current) return;
      setData(r);
      setCourses(r.courses);
      if (course && !r.courses.includes(course)) setCourse('');
      setError('');
    } catch (err) {
      if (id === latest.current) setError(err.message);
    }
  }, [q, course, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const close = () => setModal(null);
  async function remove(s) {
    const ok = await confirmDelete({
      title: 'Delete this student?',
      text: `${s.fullName} (${s.studentId}) will be permanently removed from the student records.`,
    });
    if (!ok) return;
    try {
      await api(`/students/${s.id}`, { method: 'DELETE' });
      close();
      showSuccessToast('Student deleted', s.fullName);
      load();
    } catch (err) {
      if (err.status === 404) {
        close();
        load();
      } else {
        showErrorToast('Could not delete', err.message);
      }
    }
  }
  const saved = (student) => {
    setModal((m) => (m ? { ...m, student } : m));
    load();
  };

  return (
    <section className="panel table-panel" aria-labelledby="student-list-h">
      <div className="table-head">
        <div>
          <h2 id="student-list-h">Student records</h2>
          {data && (
            <p className="muted">
              {number.format(data.total)} {data.total === 1 ? 'student' : 'students'}
              {q || course ? ' found' : ''}
            </p>
          )}
        </div>
        <div className="student-filters">
          <div className="filter">
            <label htmlFor="student-course">Course</label>
            <select
              id="student-course"
              className="field-select"
              value={course}
              onChange={(e) => {
                setCourse(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="filter student-search">
            <label htmlFor="student-search">Search</label>
            <input id="student-search" type="search" className="field-select" placeholder="Name, student ID, course or RFID" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p className="muted pad">Loading students…</p>}
      {data && data.students.length === 0 && (
        <p className="empty">{q || course ? 'No students match your search.' : 'No students yet. Add one above or import a CSV file.'}</p>
      )}
      {data && data.students.length > 0 && (
        <div className="table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Student ID</th>
                <th scope="col">RFID number</th>
                <th scope="col">Course</th>
                <th scope="col">Gender</th>
                <th scope="col">Year</th>
                <th scope="col" className="student-actions-col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr
                  key={s.id}
                  className="student-row"
                  onClick={(e) => {
                    if (!e.target.closest('.student-actions, .student-name-btn')) setModal({ student: s });
                  }}
                >
                  <td>
                    <button type="button" className="student-name-btn" onClick={() => setModal({ student: s })}>
                      {s.fullName}
                    </button>
                  </td>
                  <td>{s.studentId}</td>
                  <td>{s.rfidNumber || <span className="muted">Not assigned</span>}</td>
                  <td>{s.course}</td>
                  <td>{genderLabel(s.gender)}</td>
                  <td>{s.yearLevel}</td>
                  <td className="student-actions">
                    <IconButton kind="delete" label={`Delete ${s.fullName}`} onClick={() => remove(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && totalPages > 1 && (
        <nav className="pager" aria-label="Student pages">
          <p className="muted pager-info" role="status">
            Page {page} of {totalPages}
          </p>
          <div className="pager-pages">
            <button type="button" className="btn btn-quiet" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              Previous
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
              Next
            </button>
          </div>
        </nav>
      )}
      {modal && (
        <Modal title="Student record" className="modal-wide" onClose={() => (editorClose.current ? editorClose.current() : close())}>
          <StudentEditor key={modal.student.id} closeRef={editorClose} student={modal.student} onSaved={saved} onDelete={() => remove(modal.student)} onClose={close} />
        </Modal>
      )}
    </section>
  );
}

export default function StudentRecords() {
  const [mode, setMode] = useState('manual');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <section className="panel" aria-labelledby="add-student-h">
        <div className="table-head student-head">
          <div>
            <h2 id="add-student-h">Add students</h2>
            <p className="muted">Register a student card so the kiosk and manual attendance can find them.</p>
          </div>
          <div className="seg" role="radiogroup" aria-label="How to add students">
            {[
              ['manual', 'Enter manually'],
              ['csv', 'Import CSV'],
            ].map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className={`seg-btn${mode === value ? ' is-active' : ''}`} onClick={() => setMode(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'manual' ? <AddStudentForm onAdded={refresh} /> : <ImportCsv onImported={refresh} />}
      </section>
      <StudentList refreshKey={refreshKey} />
    </>
  );
}
