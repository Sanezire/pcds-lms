import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { ATTENDANCE_ROLES, config } from '../config.js';
import { recordAudit } from '../audit.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { publish } from '../events.js';
import { ensureStudentsTable } from './kiosk.js';
import { lockStudent, closeStaleVisits, findOpenVisit, startOfLocalDay } from '../attendance.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins only.
router.use(requireAuth, requireRole(...ATTENDANCE_ROLES));

// Manual entries with the student's details, which come from the student record.
const COLUMNS = `a.id, s.student_id, s.full_name AS student_name, s.course, s.year_level, s.gender, a.time_in, a.time_out`;
const FROM = `FROM attendance a JOIN students_data s ON s.id = a.student_data_id`;

const yearText = (n) => (n ? `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Year` : 'no year level');

// Dates come back from MySQL as UTC and are sent as ISO strings; the browser
// shows them in the viewer's own time zone.
const iso = (d) => (d ? new Date(d).toISOString() : null);

function toRecord(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    name: row.student_name,
    course: row.course,
    yearLevel: row.year_level === null ? null : Number(row.year_level),
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
      `SELECT s.student_id, s.full_name, s.course, s.year_level, s.gender,
              s.status = 'inactive' AS inactive,
              EXISTS (SELECT 1 FROM attendance a
                       WHERE a.student_data_id = s.id AND a.time_out IS NULL
                         AND a.time_in >= ?) AS timed_in
         FROM students_data s
        WHERE s.full_name LIKE ? ESCAPE '|' OR s.student_id LIKE ? ESCAPE '|'
        ORDER BY s.full_name ASC
        LIMIT 8`,
      [startOfLocalDay(), like, like]
    );
    res.json({
      students: rows.map((r) => ({
        studentId: r.student_id,
        name: r.full_name,
        course: r.course,
        yearLevel: Number(r.year_level),
        gender: r.gender,
        timedIn: Boolean(r.timed_in),
        inactive: Boolean(r.inactive),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const PAGE_SIZES = [10, 25, 50, 100];
const OFFSET_MIN = Math.trunc(config.attendance.utcOffsetMinutes);
const DAY_SQL = `DATE_FORMAT(DATE_ADD(a.time_in, INTERVAL ${OFFSET_MIN} MINUTE), '%Y-%m-%d')`;

function listFilters(q) {
  const where = [`a.type = 'manual'`];
  const params = [];

  const search = typeof q.search === 'string' ? q.search.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (search) {
    const like = `%${search.replace(/[|%_]/g, '|$&')}%`;
    where.push(`(s.full_name LIKE ? ESCAPE '|' OR s.student_id LIKE ? ESCAPE '|')`);
    params.push(like, like);
  }

  const status = q.status ?? 'all';
  if (!['all', 'in', 'out'].includes(status)) throw httpError(400, 'Invalid status.');
  if (status === 'in') where.push('a.time_out IS NULL');
  if (status === 'out') where.push('a.time_out IS NOT NULL');

  if (q.date !== undefined && q.date !== '') {
    const ok = typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && !Number.isNaN(Date.parse(`${q.date}T00:00:00Z`));
    if (!ok) throw httpError(400, 'Invalid date.');
    where.push(`${DAY_SQL} = ?`);
    params.push(q.date);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function listPaging(q) {
  let pageSize = 25;
  if (q.pageSize !== undefined && q.pageSize !== '') {
    pageSize = typeof q.pageSize === 'string' && /^\d{1,3}$/.test(q.pageSize) ? Number(q.pageSize) : 0;
    if (!PAGE_SIZES.includes(pageSize)) throw httpError(400, 'Invalid page size.');
  }
  let page = 1;
  if (q.page !== undefined && q.page !== '') {
    page = typeof q.page === 'string' && /^\d{1,7}$/.test(q.page) ? Number(q.page) : 0;
    if (page < 1) throw httpError(400, 'Invalid page.');
  }
  return { page, pageSize };
}

router.get('/', async (req, res, next) => {
  try {
    const { clause, params } = listFilters(req.query);
    const { page: wanted, pageSize } = listPaging(req.query);

    const counted = await query(`SELECT COUNT(*) AS total ${FROM} ${clause}`, params);
    const total = Number(counted[0].total);
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const page = Math.min(wanted, totalPages);

    const rows = await query(
      `SELECT ${COLUMNS}, ${DAY_SQL} AS day ${FROM} ${clause}
        ORDER BY a.time_in DESC, a.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    const days = [...new Set(rows.map((r) => r.day))];
    const dayCounts = {};
    if (days.length) {
      const perDay = await query(
        `SELECT ${DAY_SQL} AS day, COUNT(*) AS entries ${FROM} ${clause}
          AND ${DAY_SQL} IN (${days.map(() => '?').join(',')})
          GROUP BY day`,
        [...params, ...days]
      );
      perDay.forEach((d) => {
        dayCounts[d.day] = Number(d.entries);
      });
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      today: new Date(Date.now() + OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10),
      records: rows.map((r) => ({ ...toRecord(r), day: r.day })),
      dayCounts,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
});

// Manual entries are only for students in the student records; the entry links to
// the record, which is where its name, course, year level and gender come from.
async function resolveStudent(body) {
  const studentId = typeof body?.studentId === 'string' ? body.studentId.trim() : '';
  if (!studentId || studentId.length > 32) {
    throw httpError(400, 'Choose a student from the student records.', { studentId: 'Choose a student.' });
  }
  await ensureStudentsTable();
  const rows = await query(
    'SELECT id, student_id, full_name, course, year_level, gender, status FROM students_data WHERE student_id = ?',
    [studentId]
  );
  const s = rows[0];
  if (!s) {
    throw httpError(400, 'This student is not in the student records.', { studentId: 'Not in the student records.' });
  }
  return s;
}

const alreadyIn = () =>
  httpError(409, 'This student is already timed in. Time them out first.', {
    studentId: 'This student is already timed in.',
  });

const describe = (s) => `${s.full_name} (${s.student_id}), ${s.course}, ${yearText(Number(s.year_level))}`;

async function readEntry(id) {
  const rows = await query(`SELECT ${COLUMNS} ${FROM} WHERE a.id = ? AND a.type = 'manual'`, [id]);
  return rows[0];
}

// Time In is the server's clock at the moment of submission.
router.post('/', async (req, res, next) => {
  try {
    const student = await resolveStudent(req.body);
    if (student.status === 'inactive') throw httpError(409, 'This student is inactive and cannot be timed in.');

    const id = await withTransaction(async (tx) => {
      // One open visit per student, whether from the kiosk or a manual entry.
      await lockStudent(tx, student.id);
      await closeStaleVisits(tx, student.id);
      if (await findOpenVisit(tx, student.id)) throw alreadyIn();
      const result = await tx.query(
        "INSERT INTO attendance (student_data_id, type, time_in) VALUES (?, 'manual', UTC_TIMESTAMP())",
        [student.id]
      );
      return result.insertId;
    });

    publish('attendance');
    await recordAudit(req, 'attendance.time_in', `Timed in ${describe(student)}`);
    res.status(201).json({ record: toRecord(await readEntry(id)) });
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
      `UPDATE attendance SET time_out = UTC_TIMESTAMP() WHERE id = ? AND type = 'manual' AND time_out IS NULL`,
      [id]
    );

    const row = await readEntry(id);
    if (!row) throw httpError(404, 'Record not found.');
    if (!result.affectedRows) throw httpError(409, 'This student was already timed out.');
    publish('attendance');
    await recordAudit(req, 'attendance.time_out', `Timed out ${row.student_name} (${row.student_id})`);

    res.json({ record: toRecord(row) });
  } catch (err) {
    next(err);
  }
});

// Move an entry to a different student. The times are never changed here.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const student = await resolveStudent(req.body);
    await withTransaction(async (tx) => {
      await lockStudent(tx, student.id);
      const [entry] = await tx.query(`SELECT id, time_out FROM attendance WHERE id = ? AND type = 'manual'`, [id]);
      if (!entry) throw httpError(404, 'Record not found.');
      // An open entry cannot move to a student who already has an open visit.
      if (!entry.time_out) {
        const open = await findOpenVisit(tx, student.id);
        if (open && open.id !== id) throw alreadyIn();
      }
      await tx.query('UPDATE attendance SET student_data_id = ? WHERE id = ?', [student.id, id]);
    });

    publish('attendance');
    await recordAudit(req, 'attendance.edit', `Edited a manual attendance entry: now ${describe(student)}, ${student.gender}`);
    res.json({ record: toRecord(await readEntry(id)) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const before = await readEntry(id);
    const result = await query(`DELETE FROM attendance WHERE id = ? AND type = 'manual'`, [id]);
    if (!result.affectedRows) throw httpError(404, 'Record not found.');
    publish('attendance');
    await recordAudit(
      req,
      'attendance.delete',
      before ? `Deleted the manual attendance entry of ${before.student_name} (${before.student_id})` : 'Deleted a manual attendance entry'
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
