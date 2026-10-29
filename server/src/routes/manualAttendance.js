import { Router } from 'express';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { validateManualAttendance } from '../validation.js';
import { publish } from '../events.js';
import { ensureStudentsTable } from './kiosk.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins and librarians only.
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

const COLUMNS = `id, student_id, student_name, course, gender, time_in, time_out`;

// Dates come back from MySQL as UTC and are sent as ISO strings; the browser
// shows them in the viewer's own time zone.
const iso = (d) => (d ? new Date(d).toISOString() : null);

function toRecord(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    name: row.student_name,
    course: row.course,
    gender: row.gender,
    timeIn: iso(row.time_in),
    timeOut: iso(row.time_out),
  };
}

// Search the student records by name or student ID, so staff can fill in the
// form from a match. Only what the form needs is returned (never the RFID number).
router.get('/students', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    res.set('Cache-Control', 'no-store');
    if (q.length < 2) return res.json({ students: [] });

    await ensureStudentsTable();
    // "|" is the escape character, so a typed % or _ is matched literally.
    const like = `%${q.replace(/[|%_]/g, '|$&')}%`;
    const rows = await query(
      `SELECT s.student_id, s.full_name, s.course, s.gender,
              EXISTS (SELECT 1 FROM manual_attendance m
                       WHERE m.student_id = s.student_id AND m.time_out IS NULL) AS timed_in
         FROM students_data s
        WHERE s.full_name LIKE ? ESCAPE '|' OR s.student_id LIKE ? ESCAPE '|'
        ORDER BY s.full_name ASC
        LIMIT 8`,
      [like, like]
    );
    res.json({
      students: rows.map((r) => ({
        studentId: r.student_id,
        name: r.full_name,
        course: r.course,
        gender: r.gender,
        timedIn: Boolean(r.timed_in),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Students still in come first, then the most recent visits.
router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT ${COLUMNS} FROM manual_attendance
        ORDER BY (time_out IS NULL) DESC, time_in DESC, id DESC
        LIMIT 200`
    );
    res.set('Cache-Control', 'no-store');
    res.json({ records: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

// Time In is the server's clock at the moment of submission.
router.post('/', async (req, res, next) => {
  try {
    const { errors, values } = validateManualAttendance(req.body);
    if (Object.keys(errors).length) {
      throw httpError(400, 'Check the highlighted fields and try again.', errors);
    }

    let result;
    try {
      result = await query(
        `INSERT INTO manual_attendance
           (student_id, student_name, course, gender, time_in, recorded_by)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?)`,
        [values.studentId, values.name, values.course, values.gender, req.user.id]
      );
    } catch (err) {
      // The unique key on active_student_id is what really enforces this, so
      // two simultaneous submissions cannot both get through.
      if (err.code === 'ER_DUP_ENTRY') {
        throw httpError(409, 'This student is already timed in. Time them out first.', {
          studentId: 'This student is already timed in.',
        });
      }
      throw err;
    }

    publish('attendance');
    const rows = await query(`SELECT ${COLUMNS} FROM manual_attendance WHERE id = ?`, [result.insertId]);
    res.status(201).json({ record: toRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Time Out is the server's clock at the moment of the request. Only an entry
// that is still open can be timed out, so a record is never closed twice.
router.post('/:id/time-out', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const result = await query(
      `UPDATE manual_attendance SET time_out = UTC_TIMESTAMP() WHERE id = ? AND time_out IS NULL`,
      [id]
    );

    const rows = await query(`SELECT ${COLUMNS} FROM manual_attendance WHERE id = ?`, [id]);
    if (!rows[0]) throw httpError(404, 'Record not found.');
    if (!result.affectedRows) throw httpError(409, 'This student was already timed out.');
    publish('attendance');

    res.json({ record: toRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Edit the student details on an entry. The times are never changed here.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const { errors, values } = validateManualAttendance(req.body);
    if (Object.keys(errors).length) {
      throw httpError(400, 'Check the highlighted fields and try again.', errors);
    }

    let result;
    try {
      result = await query(
        `UPDATE manual_attendance
            SET student_id = ?, student_name = ?, course = ?, gender = ?
          WHERE id = ?`,
        [values.studentId, values.name, values.course, values.gender, id]
      );
    } catch (err) {
      // Changing the ID of an open entry to one that is already timed in.
      if (err.code === 'ER_DUP_ENTRY') {
        throw httpError(409, 'This student is already timed in. Time them out first.', {
          studentId: 'This student is already timed in.',
        });
      }
      throw err;
    }

    const rows = await query(`SELECT ${COLUMNS} FROM manual_attendance WHERE id = ?`, [id]);
    if (!rows[0]) throw httpError(404, 'Record not found.');
    publish('attendance');

    res.json({ record: toRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const result = await query(`DELETE FROM manual_attendance WHERE id = ?`, [id]);
    if (!result.affectedRows) throw httpError(404, 'Record not found.');
    publish('attendance');

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
