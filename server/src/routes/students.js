import { Router } from 'express';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { validateStudentRecord } from '../validation.js';
import { parseCsv } from '../csv.js';
import { ensureStudentsTable } from './kiosk.js';

const router = Router();

// Student records are managed by signed-in admins and librarians only.
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

const MAX_IMPORT_ROWS = 2000;
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
    const where = q
      ? `WHERE full_name LIKE ? ESCAPE '|' OR student_id LIKE ? ESCAPE '|' OR course LIKE ? ESCAPE '|' OR rfid_number LIKE ? ESCAPE '|'`
      : '';
    const params = q ? [like, like, like, like] : [];

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM students_data ${where}`, params);
    const rows = await query(
      `SELECT id, rfid_number, student_id, full_name, course, gender, year_level
         FROM students_data ${where}
        ORDER BY full_name ASC, id ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ total: Number(total), page, pageSize, students: rows.map(toStudent) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, values } = validateStudentRecord(req.body);
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields and try again.', errors);

    await ensureStudentsTable();
    try {
      await query(
        `INSERT INTO students_data (rfid_number, student_id, full_name, course, gender, year_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [values.rfidNumber, values.studentId, values.fullName, values.course, values.gender, values.yearLevel]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw httpError(409, 'That RFID number or student ID is already registered.', duplicateFields(err));
      }
      throw err;
    }
    res.status(201).json({ message: 'Student added.' });
  } catch (err) {
    next(err);
  }
});

// CSV import. The same call previews (commit: false) and saves (commit: true);
// either way every row is checked the same way, and rows that fail are skipped
// and reported with their line number rather than stopping the whole file.
router.post('/import', async (req, res, next) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const commit = req.body?.commit === true;
    if (!csv.trim()) throw httpError(400, 'The file is empty.');

    const table = parseCsv(csv);
    if (table.length < 2) throw httpError(400, 'The file needs a header row and at least one student.');
    if (table.length - 1 > MAX_IMPORT_ROWS) {
      throw httpError(400, `Import up to ${MAX_IMPORT_ROWS} students at a time.`);
    }

    // Map each column to a field by its header name.
    const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');
    const columnOf = {};
    table[0].cells.forEach((h, i) => {
      const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(norm(h)));
      if (field && columnOf[field] === undefined) columnOf[field] = i;
    });
    const missing = Object.keys(HEADER_ALIASES).filter((f) => columnOf[f] === undefined);
    if (missing.length) {
      const names = { rfidNumber: 'rfid_number', studentId: 'student_id', fullName: 'full_name', course: 'course', gender: 'gender', yearLevel: 'year_level' };
      throw httpError(400, `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => names[m]).join(', ')}.`);
    }

    await ensureStudentsTable();
    const existing = await query('SELECT rfid_number, student_id FROM students_data');
    const takenRfid = new Set(existing.map((r) => r.rfid_number.toUpperCase()));
    const takenId = new Set(existing.map((r) => r.student_id));

    const good = [];
    const problems = [];
    for (const { line, cells } of table.slice(1)) {
      const raw = Object.fromEntries(Object.entries(columnOf).map(([f, i]) => [f, cells[i] ?? '']));
      const { errors, values } = validateStudentRecord(raw);
      if (!errors.rfidNumber && takenRfid.has(values.rfidNumber)) errors.rfidNumber = 'RFID number already in use.';
      if (!errors.studentId && takenId.has(values.studentId)) errors.studentId = 'Student ID already exists.';
      if (Object.keys(errors).length) {
        problems.push({ line, name: raw.fullName.trim(), errors: Object.values(errors) });
        continue;
      }
      // Later rows in the same file cannot reuse these either.
      takenRfid.add(values.rfidNumber);
      takenId.add(values.studentId);
      good.push({ line, values });
    }

    let added = 0;
    if (commit) {
      for (const { line, values } of good) {
        try {
          await query(
            `INSERT INTO students_data (rfid_number, student_id, full_name, course, gender, year_level)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [values.rfidNumber, values.studentId, values.fullName, values.course, values.gender, values.yearLevel]
          );
          added += 1;
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err;
          // Someone else added the same card or ID since the check above.
          problems.push({ line, name: values.fullName, errors: Object.values(duplicateFields(err)) });
        }
      }
    }

    res.json({
      committed: commit,
      total: table.length - 1,
      valid: commit ? added : good.length,
      added,
      preview: good.slice(0, 5).map(({ values: v }) => ({
        rfidNumber: v.rfidNumber, studentId: v.studentId, fullName: v.fullName, course: v.course, gender: v.gender, yearLevel: v.yearLevel,
      })),
      problems: problems.sort((a, b) => a.line - b.line).slice(0, 100),
      problemCount: problems.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
