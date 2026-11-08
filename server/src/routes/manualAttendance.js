import { Router } from 'express';
import { query } from '../db.js';
import { ATTENDANCE_ROLES, config } from '../config.js';
import { recordAudit } from '../audit.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { publish } from '../events.js';
import { ensureStudentsTable } from './kiosk.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins only.
router.use(requireAuth, requireRole(...ATTENDANCE_ROLES));

const COLUMNS = `id, student_id, student_name, course, year_level, gender, recorded_at AS time_in, time_out`;

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
              EXISTS (SELECT 1 FROM attendance m
                       WHERE m.type = 'manual' AND m.student_id = s.student_id AND m.time_out IS NULL) AS timed_in
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
const DAY_SQL = `DATE_FORMAT(DATE_ADD(recorded_at, INTERVAL ${OFFSET_MIN} MINUTE), '%Y-%m-%d')`;

function listFilters(q) {
  const where = [];
  const params = [];

  const search = typeof q.search === 'string' ? q.search.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (search) {
    const like = `%${search.replace(/[|%_]/g, '|$&')}%`;
    where.push(`(student_name LIKE ? ESCAPE '|' OR student_id LIKE ? ESCAPE '|')`);
    params.push(like, like);
  }

  const status = q.status ?? 'all';
  if (!['all', 'in', 'out'].includes(status)) throw httpError(400, 'Invalid status.');
  if (status === 'in') where.push('time_out IS NULL');
  if (status === 'out') where.push('time_out IS NOT NULL');

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

    const counted = await query(`SELECT COUNT(*) AS total FROM attendance ${clause ? `${clause} AND` : 'WHERE'} type = 'manual'`, params);
    const total = Number(counted[0].total);
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const page = Math.min(wanted, totalPages);

    const rows = await query(
      `SELECT ${COLUMNS}, ${DAY_SQL} AS day FROM attendance ${clause ? `${clause} AND` : 'WHERE'} type = 'manual'
        ORDER BY time_in DESC, id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

    const days = [...new Set(rows.map((r) => r.day))];
    const dayCounts = {};
    if (days.length) {
      const perDay = await query(
        `SELECT ${DAY_SQL} AS day, COUNT(*) AS entries FROM attendance ${clause ? `${clause} AND` : 'WHERE'} type = 'manual'
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

// Manual entries are only for students in the student records. The entry takes
// its name, course, year level and gender from the record, never from the form.
async function resolveStudent(body) {
  const studentId = typeof body?.studentId === 'string' ? body.studentId.trim() : '';
  if (!studentId || studentId.length > 32) {
    throw httpError(400, 'Choose a student from the student records.', { studentId: 'Choose a student.' });
  }
  await ensureStudentsTable();
  const rows = await query(
    'SELECT student_id, full_name, course, year_level, gender, status FROM students_data WHERE student_id = ?',
    [studentId]
  );
  const s = rows[0];
  if (!s) {
    throw httpError(400, 'This student is not in the student records.', { studentId: 'Not in the student records.' });
  }
  return {
    status: s.status,
    values: { studentId: s.student_id, name: s.full_name, course: s.course, yearLevel: Number(s.year_level), gender: s.gender },
  };
}

// Time In is the server's clock at the moment of submission.
router.post('/', async (req, res, next) => {
  try {
    const { status, values } = await resolveStudent(req.body);
    if (status === 'inactive') throw httpError(409, 'This student is inactive and cannot be timed in.');

    // One statement inserts only when the student has no open manual entry, so two
    // simultaneous submissions cannot both get through. (A unique key cannot do this:
    // MySQL allows any number of rows whose time_out is NULL.)
    const result = await query(
      `INSERT INTO attendance
         (type, student_id, student_name, course, year_level, gender, recorded_at, recorded_by)
       SELECT 'manual', ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?
        WHERE NOT EXISTS (SELECT 1 FROM attendance
                           WHERE type = 'manual' AND student_id = ? AND time_out IS NULL)`,
      [values.studentId, values.name, values.course, values.yearLevel, values.gender, req.user.id, values.studentId]
    );
    if (!result.affectedRows) {
      throw httpError(409, 'This student is already timed in. Time them out first.', {
        studentId: 'This student is already timed in.',
      });
    }

    publish('attendance');
    await recordAudit(req, 'attendance.time_in', `Timed in ${values.name} (${values.studentId}), ${values.course}, ${yearText(values.yearLevel)}`);
    const rows = await query(`SELECT ${COLUMNS} FROM attendance WHERE id = ? AND type = 'manual'`, [result.insertId]);
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
      `UPDATE attendance SET time_out = UTC_TIMESTAMP() WHERE id = ? AND type = 'manual' AND time_out IS NULL`,
      [id]
    );

    const rows = await query(`SELECT ${COLUMNS} FROM attendance WHERE id = ? AND type = 'manual'`, [id]);
    if (!rows[0]) throw httpError(404, 'Record not found.');
    if (!result.affectedRows) throw httpError(409, 'This student was already timed out.');
    publish('attendance');
    await recordAudit(req, 'attendance.time_out', `Timed out ${rows[0].student_name} (${rows[0].student_id})`);

    res.json({ record: toRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Change which student an entry belongs to (or refresh its details from the
// student's record). The times are never changed here.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const { values } = await resolveStudent(req.body);

    // Moving an open entry to a student who already has one open is not allowed.
    const clash = await query(
      `SELECT 1 FROM attendance o JOIN attendance e ON e.id = ? AND e.type = 'manual' AND e.time_out IS NULL
        WHERE o.type = 'manual' AND o.student_id = ? AND o.time_out IS NULL AND o.id <> e.id LIMIT 1`,
      [id, values.studentId]
    );
    if (clash.length) {
      throw httpError(409, 'This student is already timed in. Time them out first.', {
        studentId: 'This student is already timed in.',
      });
    }

    let result;
    try {
      result = await query(
        `UPDATE attendance
            SET student_id = ?, student_name = ?, course = ?, year_level = ?, gender = ?
          WHERE id = ? AND type = 'manual'`,
        [values.studentId, values.name, values.course, values.yearLevel, values.gender, id]
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

    const rows = await query(`SELECT ${COLUMNS} FROM attendance WHERE id = ? AND type = 'manual'`, [id]);
    if (!rows[0]) throw httpError(404, 'Record not found.');
    publish('attendance');
    await recordAudit(
      req,
      'attendance.edit',
      `Edited the manual attendance entry of ${values.name} (${values.studentId}), ${values.course}, ${yearText(values.yearLevel)}, ${values.gender}`
    );

    res.json({ record: toRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid record.');

    const before = (await query(`SELECT ${COLUMNS} FROM attendance WHERE id = ? AND type = 'manual'`, [id]))[0];
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
