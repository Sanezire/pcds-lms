import { Router } from 'express';
import { query } from '../db.js';
import { MANAGER_ROLES, config } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { GENDERS } from '../validation.js';
import { VISITS_SQL } from '../visits.js';

const router = Router();

// Same access as the kiosk screen: signed-in admins and librarians only.
router.use(requireAuth, requireRole(...MANAGER_ROLES));

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
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

function parsePaging(q) {
  let pageSize = DEFAULT_PAGE_SIZE;
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
    const { page: wanted, pageSize } = parsePaging(req.query);

    const [counts, courses] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM (${WITH_DURATION}) r ${clause}`, params),
      query(
        `SELECT course FROM manual_attendance UNION SELECT course FROM students_data ORDER BY course`
      ),
    ]);

    const total = Number(counts[0].total);
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    // A page past the end (rows were deleted, or a filter narrowed the list) lands on the last page.
    const page = Math.min(wanted, totalPages);

    // page and pageSize are validated whole numbers, so they are safe to place in the SQL.
    const rows = await query(
      `SELECT * FROM (${WITH_DURATION}) r ${clause}
        ORDER BY time_in DESC, attendance_type, source_id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );

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
      page,
      pageSize,
      totalPages,
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

// ---- Peak usage ----
// When the library is busiest. Each visit is placed at the time the student first
// arrived that day (one visit per student per day, same as everywhere else), in the
// school's local time. Only visits on open days and inside operating hours are
// counted in the charts; the rest are reported separately so nothing disappears.

router.get('/peak', async (req, res, next) => {
  try {
    const today = fmt(new Date(Date.now() + OFFSET_MIN * 60 * 1000));
    const { from, to } = resolveRange(req.query, today);
    const { openHour, closeHour, closedWeekdays } = config.library;

    const rows = await query(
      `SELECT HOUR(arrived) AS h, WEEKDAY(arrived) AS wd, DATE_FORMAT(arrived, '%Y-%m') AS m, COUNT(*) AS c
         FROM (
           SELECT student_id, d, MIN(DATE_ADD(time_in, INTERVAL ${OFFSET_MIN} MINUTE)) AS arrived
             FROM (SELECT student_id, time_in, DATE(DATE_ADD(time_in, INTERVAL ${OFFSET_MIN} MINUTE)) AS d
                     FROM (${VISITS_SQL}) v) x
            WHERE d BETWEEN ? AND ?
            GROUP BY student_id, d
         ) y
        GROUP BY h, wd, m`,
      [from, to]
    );

    const hours = Array.from({ length: closeHour - openHour }, (_, i) => ({ hour: openHour + i, visits: 0 }));
    const weekdays = Array.from({ length: 7 }, (_, i) => ({ day: i, visits: 0, closed: closedWeekdays.includes(i) }));
    const months = new Map();
    let total = 0;
    let offHours = 0;
    for (const r of rows) {
      const c = Number(r.c);
      total += c;
      if (closedWeekdays.includes(r.wd) || r.h < openHour || r.h >= closeHour) {
        offHours += c;
        continue;
      }
      hours[r.h - openHour].visits += c;
      weekdays[r.wd].visits += c;
      months.set(r.m, (months.get(r.m) || 0) + c);
    }

    // Every month in the range, so quiet months show as zero rather than vanishing.
    const monthList = [];
    for (let k = from.slice(0, 7); k <= to.slice(0, 7); ) {
      monthList.push({ month: k, visits: months.get(k) || 0 });
      const [y, mo] = k.split('-').map(Number);
      k = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }

    // Highest / lowest; the earliest one wins a tie. Nothing is "busiest" with no visits.
    const top = (list) => list.reduce((a, b) => (b.visits > a.visits ? b : a));
    const best = (list, pick) => (list.some((x) => x.visits > 0) ? pick(top(list)) : null);
    const least = (list, pick) =>
      list.some((x) => x.visits > 0) ? pick(list.reduce((a, b) => (b.visits < a.visits ? b : a))) : null;
    const openDays = weekdays.filter((d) => !d.closed);

    res.set('Cache-Control', 'no-store');
    res.json({
      today,
      from,
      to,
      total,
      counted: total - offHours,
      offHours,
      hours: { open: openHour, close: closeHour, closedWeekdays },
      byHour: hours,
      byWeekday: weekdays,
      byMonth: monthList,
      insights: {
        busiestDay: best(openDays, (d) => ({ day: d.day, visits: d.visits })),
        leastBusyDay: least(openDays, (d) => ({ day: d.day, visits: d.visits })),
        busiestMonth: best(monthList, (m) => ({ month: m.month, visits: m.visits })),
        busiestHour: best(hours, (h) => ({ hour: h.hour, visits: h.visits })),
        leastBusyHour: least(hours, (h) => ({ hour: h.hour, visits: h.visits })),
      },
    });
  } catch (err) {
    next(err);
  }
});

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
                COALESCE(SUM(d = ?), 0) AS today
           FROM (${VISIT_DAYS_SQL}) x`,
        [monthStart, weekStart, today]
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
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---- Library visit trends ----
// Daily, monthly and yearly visit counts, a comparison between years, and a
// custom date range. Every number comes from VISIT_DAYS_SQL, so a student still
// counts once per day.

const MAX_COMPARE_YEARS = 4;

const parseYear = (value, label = 'Year') => {
  const y = Number(value);
  if (!/^\d{4}$/.test(String(value)) || y < 2000 || y > 2100) throw httpError(400, `${label} is not valid.`);
  return y;
};

const monthKeys = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

async function countByMonth(fromDay, toDay) {
  const rows = await query(
    `SELECT DATE_FORMAT(d, '%Y-%m') AS k, COUNT(*) AS visits
       FROM (${VISIT_DAYS_SQL}) x
      WHERE d BETWEEN ? AND ?
      GROUP BY k`,
    [fromDay, toDay]
  );
  return new Map(rows.map((r) => [r.k, Number(r.visits)]));
}

router.get('/trends', async (req, res, next) => {
  try {
    const today = fmt(new Date(Date.now() + OFFSET_MIN * 60 * 1000));
    const thisYear = Number(today.slice(0, 4));
    const thisMonth = today.slice(0, 7);
    const q = req.query;
    const report = ['daily', 'monthly', 'annual', 'compare', 'custom'].includes(q.report) ? q.report : null;
    if (!report) throw httpError(400, 'Invalid report.');

    // Years that have visits, so the pickers only offer years worth choosing.
    const yearRows = await query(`SELECT DISTINCT YEAR(d) AS y FROM (${VISIT_DAYS_SQL}) x ORDER BY y`);
    const years = [...new Set([...yearRows.map((r) => Number(r.y)), thisYear])].sort((a, b) => a - b);

    const out = { report, today, years };

    if (report === 'daily') {
      const month = typeof q.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month) ? q.month : thisMonth;
      const first = `${month}-01`;
      const last = fmt(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)));
      const rows = await query(
        `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, COUNT(*) AS visits
           FROM (${VISIT_DAYS_SQL}) x WHERE d BETWEEN ? AND ? GROUP BY d`,
        [first, last]
      );
      const perDay = new Map(rows.map((r) => [r.day, Number(r.visits)]));
      out.granularity = 'day';
      out.label = month;
      out.buckets = Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => {
        const key = addDays(first, i);
        return { key, visits: perDay.get(key) || 0, future: key > today };
      });
    } else if (report === 'monthly') {
      const year = q.year ? parseYear(q.year) : thisYear;
      const counts = await countByMonth(`${year}-01-01`, `${year}-12-31`);
      out.granularity = 'month';
      out.label = String(year);
      out.buckets = monthKeys(year).map((key) => ({ key, visits: counts.get(key) || 0, future: key > thisMonth }));
    } else if (report === 'annual') {
      const rows = await query(
        `SELECT YEAR(d) AS y, COUNT(*) AS visits FROM (${VISIT_DAYS_SQL}) x GROUP BY y`
      );
      const perYear = new Map(rows.map((r) => [Number(r.y), Number(r.visits)]));
      const firstYear = Math.min(years[0], thisYear);
      out.granularity = 'year';
      out.label = 'All years';
      out.buckets = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => {
        const y = firstYear + i;
        return { key: String(y), visits: perYear.get(y) || 0, future: false };
      });
    } else if (report === 'compare') {
      const picked = [...new Set(String(q.years || '').split(',').filter(Boolean).map((y) => parseYear(y)))]
        .sort((a, b) => a - b);
      if (picked.length < 2) throw httpError(400, 'Choose at least two years to compare.');
      if (picked.length > MAX_COMPARE_YEARS) throw httpError(400, `Compare up to ${MAX_COMPARE_YEARS} years at a time.`);
      const counts = await countByMonth(`${picked[0]}-01-01`, `${picked[picked.length - 1]}-12-31`);
      out.granularity = 'month';
      out.label = picked.join(' vs ');
      out.series = picked.map((year) => ({
        year,
        buckets: monthKeys(year).map((key) => ({ key, visits: counts.get(key) || 0, future: key > thisMonth })),
      }));
    } else {
      const { from, to } = resolveRange({ ...q, range: 'custom' }, today);
      const span = daysBetween(from, to) + 1;
      out.from = from;
      out.to = to;
      if (span <= DAILY_BARS_UP_TO_DAYS) {
        const rows = await query(
          `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, COUNT(*) AS visits
             FROM (${VISIT_DAYS_SQL}) x WHERE d BETWEEN ? AND ? GROUP BY d`,
          [from, to]
        );
        const perDay = new Map(rows.map((r) => [r.day, Number(r.visits)]));
        out.granularity = 'day';
        out.buckets = Array.from({ length: span }, (_, i) => {
          const key = addDays(from, i);
          return { key, visits: perDay.get(key) || 0, future: false };
        });
      } else {
        const counts = await countByMonth(from, to);
        out.granularity = 'month';
        const keys = [];
        for (let k = from.slice(0, 7); k <= to.slice(0, 7); ) {
          keys.push(k);
          const [y, m] = k.split('-').map(Number);
          k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        }
        // Months at the edge of the range only count the days inside it.
        out.buckets = keys.map((key) => ({ key, visits: counts.get(key) || 0, future: false }));
      }
    }

    const all = out.series ? out.series.flatMap((s) => s.buckets) : out.buckets;
    out.total = all.reduce((n, b) => n + b.visits, 0);
    res.set('Cache-Control', 'no-store');
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ---- Visits by academic program and year level ----
// Every visit is one student on one school day (same rule as everywhere else).
// The program and year level come from the student's record in students_data;
// for a manual entry from a student without a record, the course typed in the
// entry is used and the year level is unknown. Visits by accounts with no
// program at all (staff, for example) are not student visits and are left out.

const MAX_PROGRAM_RANGE_DAYS = 3660;

async function resolveProgramRange(q, today) {
  const year = Number(today.slice(0, 4));
  switch (q.range ?? 'all') {
    case 'all': {
      const rows = await query(`SELECT DATE_FORMAT(MIN(d), '%Y-%m-%d') AS first FROM (${VISIT_DAYS_SQL}) x`);
      return { from: rows[0]?.first || today, to: today };
    }
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'custom': {
      const from = parseDay(q.from, 'Start date');
      const to = parseDay(q.to, 'End date');
      if (from > to) throw httpError(400, 'The start date cannot be after the end date.');
      if (to > today) throw httpError(400, 'The end date cannot be in the future.');
      if (daysBetween(from, to) + 1 > MAX_PROGRAM_RANGE_DAYS) throw httpError(400, 'Choose a period of up to 10 years.');
      return { from, to };
    }
    default:
      return resolveRange(q, today); // last7, last30, last90, month, year
  }
}

// One row per student per day, with the program the student belongs to.
const PROGRAM_VISITS_SQL = `
  SELECT COALESCE(NULLIF(TRIM(sd.course), ''), NULLIF(TRIM(x.manual_course), '')) AS program,
         sd.year_level AS year_level
    FROM (
      SELECT student_id,
             DATE(DATE_ADD(time_in, INTERVAL ${OFFSET_MIN} MINUTE)) AS d,
             MAX(course) AS manual_course
        FROM (${VISITS_SQL}) v
       GROUP BY student_id, d
    ) x
    LEFT JOIN students_data sd ON sd.student_id = x.student_id
   WHERE x.d BETWEEN ? AND ?
`;

router.get('/program-year', async (req, res, next) => {
  try {
    const today = fmt(new Date(Date.now() + OFFSET_MIN * 60 * 1000));
    const { from, to } = await resolveProgramRange(req.query, today);

    let yearLevel = null;
    if (req.query.year !== undefined && req.query.year !== '') {
      if (typeof req.query.year !== 'string' || !/^[1-6]$/.test(req.query.year)) throw httpError(400, 'Invalid year level.');
      yearLevel = Number(req.query.year);
    }

    const [rows, levels, left] = await Promise.all([
      query(
        `SELECT program, year_level, COUNT(*) AS visits
           FROM (${PROGRAM_VISITS_SQL}) p
          WHERE program IS NOT NULL ${yearLevel ? 'AND year_level = ?' : ''}
          GROUP BY program, year_level
          ORDER BY program, year_level`,
        yearLevel ? [from, to, yearLevel] : [from, to]
      ),
      query('SELECT DISTINCT year_level FROM students_data ORDER BY year_level'),
      query(`SELECT COUNT(*) AS n FROM (${PROGRAM_VISITS_SQL}) p WHERE program IS NULL`, [from, to]),
    ]);

    const cells = rows.map((r) => ({
      program: r.program,
      yearLevel: r.year_level === null ? null : Number(r.year_level),
      visits: Number(r.visits),
    }));

    res.set('Cache-Control', 'no-store');
    res.json({
      today,
      from,
      to,
      yearLevel,
      yearLevels: levels.map((l) => Number(l.year_level)),
      total: cells.reduce((n, c) => n + c.visits, 0),
      leftOut: Number(left[0].n),
      rows: cells,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
