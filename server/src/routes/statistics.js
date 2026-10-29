import { Router } from 'express';
import { query } from '../db.js';
import { ROLES, config } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { GENDERS } from '../validation.js';
import { VISITS_SQL } from '../visits.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins and librarians only.
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

const MAX_ROWS = 500;
const MAX_MINUTES = 60 * 24 * 366;

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

// ---- Library visits ----
// A visit is one student on one school day. Timing in and out several times in
// the same day counts once, whether the taps came from the RFID kiosk, manual
// entries, or both. The day is the school's local day (ATTENDANCE_UTC_OFFSET_MINUTES).

const OFFSET_MIN = Math.trunc(config.attendance.utcOffsetMinutes);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const DAILY_BARS_UP_TO_DAYS = 62; // longer periods are shown one bar per month

// One row per student per school day. The offset is a number from the server
// configuration, never user input.
const VISIT_DAYS_SQL = `
  SELECT student_id, DATE(DATE_ADD(time_in, INTERVAL ${OFFSET_MIN} MINUTE)) AS d
    FROM (${VISITS_SQL}) v
   GROUP BY student_id, d
`;

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * DAY_MS));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);

function parseDay(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || fmt(toDate(value)) !== value) {
    throw httpError(400, `${label} is not a valid date.`);
  }
  return value;
}

function resolveRange(q, today) {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (q.range) {
    case undefined:
    case '':
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom': {
      const from = parseDay(q.from, 'Start date');
      const to = parseDay(q.to, 'End date');
      if (from > to) throw httpError(400, 'The start date cannot be after the end date.');
      if (to > today) throw httpError(400, 'The end date cannot be in the future.');
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
        throw httpError(400, `Choose a period of up to ${MAX_RANGE_DAYS} days.`);
      }
      return { from, to };
    }
    default:
      throw httpError(400, 'Invalid period.');
  }
}

router.get('/visits', async (req, res, next) => {
  try {
    const today = fmt(new Date(Date.now() + OFFSET_MIN * 60 * 1000));
    const { from, to } = resolveRange(req.query, today);

    const monthStart = `${today.slice(0, 7)}-01`;
    const weekStart = addDays(today, -((toDate(today).getUTCDay() + 6) % 7)); // Monday

    const [rows, sums] = await Promise.all([
      query(
        `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, COUNT(*) AS visits
           FROM (${VISIT_DAYS_SQL}) x
          WHERE d BETWEEN ? AND ?
          GROUP BY d
          ORDER BY d`,
        [from, to]
      ),
      query(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(d >= ?), 0) AS this_month,
                COALESCE(SUM(d >= ?), 0) AS this_week,
                COALESCE(SUM(d = ?), 0) AS today,
                COUNT(DISTINCT CASE WHEN d >= ? THEN student_id END) AS students_month
           FROM (${VISIT_DAYS_SQL}) x`,
        [monthStart, weekStart, today, monthStart]
      ),
    ]);

    const perDay = new Map(rows.map((r) => [r.day, Number(r.visits)]));
    const span = daysBetween(from, to) + 1;
    const granularity = span <= DAILY_BARS_UP_TO_DAYS ? 'day' : 'month';

    const bars = [];
    if (granularity === 'day') {
      for (let i = 0; i < span; i += 1) {
        const day = addDays(from, i);
        bars.push({ key: day, visits: perDay.get(day) || 0 });
      }
    } else {
      const byMonth = new Map();
      for (let i = 0; i < span; i += 1) {
        const day = addDays(from, i);
        const key = day.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) || 0) + (perDay.get(day) || 0));
      }
      for (const [key, visits] of byMonth) bars.push({ key, visits });
    }

    const sum = sums[0];
    res.set('Cache-Control', 'no-store');
    res.json({
      today,
      from,
      to,
      granularity,
      bars,
      periodTotal: bars.reduce((n, b) => n + b.visits, 0),
      summary: {
        total: Number(sum.total),
        thisMonth: Number(sum.this_month),
        thisWeek: Number(sum.this_week),
        today: Number(sum.today),
        studentsThisMonth: Number(sum.students_month),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
