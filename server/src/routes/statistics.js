import { Router } from 'express';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { GENDERS } from '../validation.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins and librarians only.
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

const MAX_ROWS = 500;
const MAX_MINUTES = 60 * 24 * 366;

// Every visit as one row, from both sources.
//  - RFID taps are stored one row per tap, so each 'in' tap is paired with the
//    very next tap by the same student. If that next tap is an 'out' it closes
//    the visit; otherwise (no later tap, or another 'in') the visit is still open.
//  - Manual rows already hold Time In and Time Out together.
// RFID rows carry no course or gender because the users table does not store them.
const VISITS_SQL = `
  SELECT 'rfid' AS attendance_type,
         t.id AS source_id,
         u.full_name AS student_name,
         u.member_id AS student_id,
         CAST(NULL AS CHAR(100)) AS course,
         CAST(NULL AS CHAR(10)) AS gender,
         t.recorded_at AS time_in,
         CASE WHEN t.next_action = 'out' THEN t.next_at END AS time_out
    FROM (
      SELECT id, user_id, action, recorded_at,
             LEAD(action) OVER (PARTITION BY user_id ORDER BY recorded_at, id) AS next_action,
             LEAD(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at, id) AS next_at
        FROM attendance
    ) t
    JOIN users u ON u.id = t.user_id
   WHERE t.action = 'in'
  UNION ALL
  SELECT 'manual', m.id, m.student_name, m.student_id,
         CAST(m.course AS CHAR(100)), CAST(m.gender AS CHAR(10)), m.time_in, m.time_out
    FROM manual_attendance m
`;

const iso = (d) => (d ? new Date(d).toISOString() : null);

function toWholeNumber(value, label) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,7}$/.test(value)) {
    throw httpError(400, `${label} must be a whole number.`);
  }
  const n = Number(value);
  if (n > MAX_MINUTES) throw httpError(400, `${label} is too large.`);
  return n;
}

function buildFilters(q) {
  const where = [];
  const params = [];

  const course = typeof q.course === 'string' ? q.course.trim() : '';
  if (course) {
    if (course.length > 100) throw httpError(400, 'Course is too long.');
    where.push('course = ?');
    params.push(course);
  }

  const gender = typeof q.gender === 'string' ? q.gender.trim().toLowerCase() : '';
  if (gender) {
    if (!GENDERS.includes(gender)) throw httpError(400, 'Invalid gender filter.');
    where.push('gender = ?');
    params.push(gender);
  }

  if (q.type !== undefined && q.type !== '') {
    if (!['rfid', 'manual'].includes(q.type)) throw httpError(400, 'Invalid type filter.');
    where.push('attendance_type = ?');
    params.push(q.type);
  }

  if (q.status !== undefined && q.status !== '') {
    if (!['in', 'out'].includes(q.status)) throw httpError(400, 'Invalid status filter.');
    where.push(q.status === 'in' ? 'time_out IS NULL' : 'time_out IS NOT NULL');
  }

  // Duration is whole minutes, matching what the page shows (for example 2h 0m).
  // Students who have not timed out yet are measured from Time In until now.
  const minMinutes = toWholeNumber(q.minMinutes, 'Minimum duration');
  const maxMinutes = toWholeNumber(q.maxMinutes, 'Maximum duration');
  if (minMinutes !== null && maxMinutes !== null && minMinutes > maxMinutes) {
    throw httpError(400, 'Minimum duration cannot be longer than the maximum.');
  }
  if (minMinutes !== null) {
    where.push('duration_minutes >= ?');
    params.push(minMinutes);
  }
  if (maxMinutes !== null) {
    where.push('duration_minutes <= ?');
    params.push(maxMinutes);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const WITH_DURATION = `
  SELECT v.*, GREATEST(TIMESTAMPDIFF(MINUTE, v.time_in, COALESCE(v.time_out, UTC_TIMESTAMP())), 0) AS duration_minutes
    FROM (${VISITS_SQL}) v
`;

router.get('/attendance', async (req, res, next) => {
  try {
    const { clause, params } = buildFilters(req.query);

    const [rows, counts, courses] = await Promise.all([
      query(
        `SELECT * FROM (${WITH_DURATION}) r ${clause}
          ORDER BY time_in DESC, source_id DESC
          LIMIT ${MAX_ROWS}`,
        params
      ),
      query(`SELECT COUNT(*) AS total FROM (${WITH_DURATION}) r ${clause}`, params),
      query(`SELECT DISTINCT course FROM manual_attendance ORDER BY course`),
    ]);

    const total = Number(counts[0].total);
    res.set('Cache-Control', 'no-store');
    res.json({
      serverTime: new Date().toISOString(),
      records: rows.map((r) => ({
        key: `${r.attendance_type}-${r.source_id}`,
        type: r.attendance_type,
        name: r.student_name,
        studentId: r.student_id,
        course: r.course,
        gender: r.gender,
        timeIn: iso(r.time_in),
        timeOut: iso(r.time_out),
        durationMinutes: Number(r.duration_minutes),
        active: !r.time_out,
      })),
      total,
      limited: total > rows.length,
      options: { courses: courses.map((c) => c.course) },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
