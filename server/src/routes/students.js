import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { MANAGER_ROLES } from '../config.js';
import { recordAudit } from '../audit.js';
import { publish } from '../events.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { validateStudentRecord } from '../validation.js';
import { parseCsv } from '../csv.js';
import { ensureStudentsTable } from './kiosk.js';
import { MAX_YEAR_LEVEL, registerOrPromote, yearText } from '../studentPromotion.js';

const router = Router();

// Student records are managed by signed-in admins only.
router.use(requireAuth, requireRole(...MANAGER_ROLES));

// Long ID lists are sent to the database in batches, so even a whole school's
// list stays well under the database's limit on values in one statement.
const BATCH = 1000;
async function inBatches(list, run) {
  const out = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const part = list.slice(i, i + BATCH);
    const rows = await run(part, part.map(() => '?').join(','));
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}
const PAGE_SIZE_MAX = 100;

// Accepted CSV column names (compared lower-case, without spaces or underscores).
const HEADER_ALIASES = {
  rfidNumber: ['rfidnumber', 'rfid', 'rfidno', 'cardnumber', 'card'],
  studentId: ['studentid', 'studentnumber', 'studentno', 'id'],
  fullName: ['fullname', 'name', 'studentname'],
  course: ['course', 'program'],
  gender: ['gender', 'sex'],
  yearLevel: ['yearlevel', 'year'],
};

const toStudent = (r) => ({
  id: r.id,
  rfidNumber: r.rfid_number,
  studentId: r.student_id,
  fullName: r.full_name,
  course: r.course,
  gender: r.gender,
  yearLevel: r.year_level,
  status: r.status,
});

// Says which field a duplicate-key error is about.
function duplicateFields(err) {
  const msg = String(err.sqlMessage);
  return msg.includes('uq_students_data_rfid')
    ? { rfidNumber: 'This RFID number is already assigned to a student.' }
    : { studentId: 'This student ID already exists.' };
}

router.get('/', async (req, res, next) => {
  try {
    await ensureStudentsTable();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), PAGE_SIZE_MAX);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const like = `%${q.replace(/[|%_]/g, '|$&')}%`;
    const course = typeof req.query.course === 'string' ? req.query.course.trim().slice(0, 100) : '';
    const rfid = typeof req.query.rfid === 'string' ? req.query.rfid : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    if (!['active','inactive','all'].includes(status)) throw httpError(400, 'Invalid status filter.');
    if (!['', 'with', 'without'].includes(rfid)) throw httpError(400, 'Invalid RFID filter.');
    const clauses = [];
    const params = [];
    if (rfid === 'with') clauses.push("(rfid_number IS NOT NULL AND rfid_number <> '')");
    if (rfid === 'without') clauses.push("(rfid_number IS NULL OR rfid_number = '')");
    if (q) {
      clauses.push(`(full_name LIKE ? ESCAPE '|' OR student_id LIKE ? ESCAPE '|' OR course LIKE ? ESCAPE '|' OR rfid_number LIKE ? ESCAPE '|')`);
      params.push(like, like, like, like);
    }
    if (course) {
      clauses.push('course = ?');
      params.push(course);
    }
    if (status !== 'all') { clauses.push('status = ?'); params.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM students_data ${where}`, params);
    const rows = await query(
      `SELECT id, rfid_number, student_id, full_name, course, gender, year_level, status
         FROM students_data ${where}
        ORDER BY full_name ASC, id ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const courses = (await query('SELECT DISTINCT course FROM students_data ORDER BY course ASC')).map((r) => r.course);
    res.set('Cache-Control', 'no-store');
    res.json({ total: Number(total), page, pageSize, courses, students: rows.map(toStudent) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, values } = validateStudentRecord(req.body);
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields and try again.', errors);

    await ensureStudentsTable();
    const outcome = await withTransaction((tx) => registerOrPromote(tx, values));

    if (outcome.action === 'failed') {
      throw httpError(409, outcome.reason, { rfidNumber: outcome.reason });
    }
    if (outcome.action === 'skipped') {
      return res.json({
        action: 'skipped',
        message: `${outcome.name} (${values.studentId}) is already registered and is already in ${yearText(outcome.from)}, the highest year level. Nothing was changed.`,
      });
    }
    if (outcome.action === 'promoted') {
      publish('attendance');
      await recordAudit(
        req,
        'student.promote',
        `Promoted student ${outcome.name} (${values.studentId}) from ${yearText(outcome.from)} to ${yearText(outcome.to)}`
      );
      return res.json({
        action: 'promoted',
        fromYear: outcome.from,
        toYear: outcome.to,
        message: `${outcome.name} (${values.studentId}) is already registered. Year level moved from ${yearText(outcome.from)} to ${yearText(outcome.to)}; all other details were kept.`,
      });
    }

    await recordAudit(req, 'student.add', `Added student ${values.fullName} (${values.studentId}), ${values.course}`);
    res.status(201).json({ action: 'added', message: 'Student added.' });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid student.');

    const { errors, values } = validateStudentRecord(req.body);
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields and try again.', errors);

    await ensureStudentsTable();
    const before = await query('SELECT student_id, full_name FROM students_data WHERE id = ?', [id]);
    if (!before[0]) throw httpError(404, 'Student not found.');

    try {
      await query(
        `UPDATE students_data
            SET rfid_number = ?, student_id = ?, full_name = ?, course = ?, gender = ?, year_level = ?
          WHERE id = ?`,
        [values.rfidNumber, values.studentId, values.fullName, values.course, values.gender, values.yearLevel, id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw httpError(409, 'That RFID number or student ID is already registered.', duplicateFields(err));
      }
      throw err;
    }

    const rows = await query(
      'SELECT id, rfid_number, student_id, full_name, course, gender, year_level FROM students_data WHERE id = ?',
      [id]
    );
    publish('attendance');
    await recordAudit(
      req,
      'student.edit',
      `Edited student ${values.fullName} (${values.studentId}), ${values.course}, year ${values.yearLevel}`
    );
    res.json({ student: toStudent(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid student.');

    await ensureStudentsTable();
    const rows = await query('SELECT student_id, full_name, course FROM students_data WHERE id = ?', [id]);
    if (!rows[0]) throw httpError(404, 'Student not found.');

    try {
      await query('DELETE FROM students_data WHERE id = ?', [id]);
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
        throw httpError(409, 'This student has attendance records, so the record cannot be deleted. Deactivate it instead.');
      }
      throw err;
    }

    publish('attendance');
    await recordAudit(req, 'student.delete', `Deleted student ${rows[0].full_name} (${rows[0].student_id}), ${rows[0].course}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/import', async (req, res, next) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const commit = req.body?.commit === true;
    if (!csv.trim()) throw httpError(400, 'The file is empty.');

    const table = parseCsv(csv);
    if (table.length < 2) throw httpError(400, 'The file needs a header row and at least one student.');

    // Map each column to a field by its header name.
    const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');
    const columnOf = {};
    table[0].cells.forEach((h, i) => {
      const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(norm(h)));
      if (field && columnOf[field] === undefined) columnOf[field] = i;
    });
    const missing = Object.keys(HEADER_ALIASES).filter((f) => f !== 'rfidNumber' && columnOf[f] === undefined);
    if (missing.length) {
      const names = { rfidNumber: 'rfid_number', studentId: 'student_id', fullName: 'full_name', course: 'course', gender: 'gender', yearLevel: 'year_level' };
      throw httpError(400, `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => names[m]).join(', ')}.`);
    }

    await ensureStudentsTable();
    const existingRows = await query(
      'SELECT rfid_number, student_id, full_name, course, gender, year_level, status FROM students_data'
    );
    const existing = new Map(existingRows.map((r) => [r.student_id, r]));
    const takenRfid = new Set(existingRows.filter((r) => r.rfid_number).map((r) => r.rfid_number.toUpperCase()));

    const queue = [];
    const skippedRows = [];
    const failedRows = [];
    const firstLine = new Map();
    for (const { line, cells } of table.slice(1)) {
      const raw = Object.fromEntries(Object.keys(HEADER_ALIASES).map((f) => [f, columnOf[f] === undefined ? '' : cells[columnOf[f]] ?? '']));
      const { errors, values } = validateStudentRecord(raw);
      if (Object.keys(errors).length) {
        failedRows.push({ line, name: raw.fullName.trim(), reason: Object.values(errors).join(' ') });
        continue;
      }

      if (firstLine.has(values.studentId)) {
        skippedRows.push({ line, name: values.fullName, reason: `This student ID was already handled on line ${firstLine.get(values.studentId)} of the file.` });
        continue;
      }
      firstLine.set(values.studentId, line);

      const current = existing.get(values.studentId);
      if (current) {
        if (current.status === 'inactive') {
          skippedRows.push({ line, name: current.full_name, reason: 'This student is inactive and was skipped.' });
          continue;
        }
        const from = Number(current.year_level);
        if (from >= MAX_YEAR_LEVEL) {
          skippedRows.push({ line, name: current.full_name, reason: `Already in ${yearText(from)}, the highest year level.` });
          continue;
        }
        queue.push({
          line,
          values,
          preview: {
            action: 'promoted',
            rfidNumber: current.rfid_number,
            studentId: current.student_id,
            fullName: current.full_name,
            course: current.course,
            gender: current.gender,
            fromYear: from,
            toYear: from + 1,
          },
        });
        continue;
      }

      if (values.rfidNumber && takenRfid.has(values.rfidNumber)) {
        failedRows.push({ line, name: values.fullName, reason: 'RFID number already in use.' });
        continue;
      }
      if (values.rfidNumber) takenRfid.add(values.rfidNumber);
      queue.push({
        line,
        values,
        preview: { action: 'added', rfidNumber: values.rfidNumber, studentId: values.studentId, fullName: values.fullName, course: values.course, gender: values.gender, yearLevel: values.yearLevel },
      });
    }

    let added = queue.filter((q) => q.preview.action === 'added').length;
    let promoted = queue.length - added;
    if (commit) {
      const outcome = await withTransaction(async (tx) => {
        const done = { added: 0, promoted: 0, skipped: [], failed: [] };
        for (const item of queue) {
          const r = await registerOrPromote(tx, item.values);
          if (r.action === 'added') done.added += 1;
          else if (r.action === 'promoted') done.promoted += 1;
          else if (r.action === 'skipped') done.skipped.push({ line: item.line, name: r.name, reason: r.reason });
          else done.failed.push({ line: item.line, name: item.values.fullName, reason: r.reason });
        }
        return done;
      });
      added = outcome.added;
      promoted = outcome.promoted;
      skippedRows.push(...outcome.skipped);
      failedRows.push(...outcome.failed);

      if (promoted > 0) publish('attendance');
      await recordAudit(
        req,
        'student.import',
        `Imported a CSV file: ${added} added, ${promoted} promoted, ${skippedRows.length} skipped, ${failedRows.length} failed`
      );
    }

    const byLine = (a, b) => a.line - b.line;
    res.json({
      committed: commit,
      total: table.length - 1,
      added,
      promoted,
      skipped: skippedRows.length,
      failed: failedRows.length,
      preview: queue.slice(0, 5).map((q) => q.preview),
      skippedRows: skippedRows.sort(byLine).slice(0, 100),
      failedRows: failedRows.sort(byLine).slice(0, 100),
    });
  } catch (err) {
    next(err);
  }
});

// Deactivate selected records without deleting their student or attendance history.
router.post('/deactivate', async (req, res, next) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map(Number))];
    if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw httpError(400, 'Choose valid students to deactivate.');
    const rows = await inBatches(ids, async (part, marks) => {
      const found = await query(`SELECT id, student_id, full_name FROM students_data WHERE id IN (${marks}) AND status='active'`, part);
      await query(`UPDATE students_data SET status='inactive' WHERE id IN (${marks}) AND status='active'`, part);
      return found;
    });
    for (const s of rows) await recordAudit(req, 'student.deactivate', `Deactivated student ${s.full_name} (${s.student_id})`);
    publish('attendance');
    res.json({ deactivated: rows.length, unmatched: ids.length - rows.length });
  } catch (err) { next(err); }
});

router.post('/reactivate', async (req, res, next) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map(Number))];
    if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw httpError(400, 'Choose valid students to reactivate.');
    const rows = await inBatches(ids, async (part, marks) => {
      const found = await query(`SELECT id,student_id,full_name FROM students_data WHERE id IN (${marks}) AND status='inactive'`, part);
      await query(`UPDATE students_data SET status='active' WHERE id IN (${marks}) AND status='inactive'`, part);
      return found;
    });
    for (const s of rows) await recordAudit(req, 'student.reactivate', `Reactivated student ${s.full_name} (${s.student_id})`);
    publish('attendance');
    res.json({ reactivated: rows.length, unmatched: ids.length - rows.length });
  } catch (err) { next(err); }
});

// Deactivate students listed in a CSV (student_id column). Like the student
// import, the file is checked first and nothing changes until commit is true.
router.post('/deactivate/import', async (req, res, next) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const commit = req.body?.commit === true;
    const table = parseCsv(csv);
    if (table.length < 2) throw httpError(400, 'Provide a CSV with a header and at least one student row.');
    const idCol = table[0].cells.findIndex((h) => ['studentid', 'studentnumber', 'studentno', 'id'].includes(h.toLowerCase().replace(/[^a-z]/g, '')));
    if (idCol < 0) throw httpError(400, 'Missing column: student_id.');

    const rows = table.slice(1).map(({ line, cells }) => ({ line, id: (cells[idCol] || '').trim() }));
    const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
    const found = await inBatches(ids, (part, marks) =>
      query(`SELECT id, rfid_number, student_id, full_name, course, gender, year_level, status FROM students_data WHERE student_id IN (${marks})`, part)
    );
    const byId = new Map(found.map((s) => [s.student_id, s]));

    const toDeactivate = [];
    const skippedRows = [];
    const failedRows = [];
    const firstLine = new Map();
    for (const { line, id } of rows) {
      const s = byId.get(id);
      if (!id) failedRows.push({ line, reason: 'No student ID on this line.' });
      else if (firstLine.has(id)) skippedRows.push({ line, name: s?.full_name, reason: `This student ID was already handled on line ${firstLine.get(id)} of the file.` });
      else {
        firstLine.set(id, line);
        if (!s) failedRows.push({ line, name: id, reason: 'This student ID is not in the student records.' });
        else if (s.status === 'inactive') skippedRows.push({ line, name: s.full_name, reason: 'This student is already inactive.' });
        else toDeactivate.push(s);
      }
    }

    if (commit && toDeactivate.length) {
      await inBatches(toDeactivate.map((s) => s.id), (part, marks) => query(`UPDATE students_data SET status='inactive' WHERE id IN (${marks}) AND status='active'`, part));
      for (const s of toDeactivate) await recordAudit(req, 'student.deactivate', `Deactivated student ${s.full_name} (${s.student_id}) by CSV import`);
      publish('attendance');
    }

    const byLine = (x, y) => x.line - y.line;
    res.json({
      committed: commit,
      total: rows.length,
      deactivated: toDeactivate.length,
      skipped: skippedRows.length,
      failed: failedRows.length,
      preview: toDeactivate.slice(0, 5).map((s) => ({
        rfidNumber: s.rfid_number,
        studentId: s.student_id,
        fullName: s.full_name,
        course: s.course,
        gender: s.gender,
        yearLevel: Number(s.year_level),
      })),
      skippedRows: skippedRows.sort(byLine).slice(0, 100),
      failedRows: failedRows.sort(byLine).slice(0, 100),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
