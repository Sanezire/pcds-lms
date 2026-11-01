import { Router } from 'express';
import { query } from '../db.js';
import { config, ATTENDANCE_ROLES } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { VISITS_SQL } from '../visits.js';

const router = Router();

router.use(requireAuth, requireRole(...ATTENDANCE_ROLES));

const OFFSET_MIN = Math.trunc(config.attendance.utcOffsetMinutes);
const localDay = (col) => `DATE(DATE_ADD(${col}, INTERVAL ${OFFSET_MIN} MINUTE))`;

router.get('/summary', async (req, res, next) => {
  try {
    const today = new Date(Date.now() + OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10);

    const rows = await query(
      `SELECT COUNT(DISTINCT CASE WHEN ${localDay('time_in')} = ? THEN student_id END) AS visits_today,
              COUNT(CASE WHEN time_out IS NULL AND ${localDay('time_in')} = ? THEN 1 END) AS inside_now,
              COUNT(CASE WHEN time_out IS NOT NULL AND ${localDay('time_out')} = ? THEN 1 END) AS timed_out_today,
              AVG(CASE WHEN time_out IS NOT NULL AND ${localDay('time_out')} = ?
                       THEN GREATEST(TIMESTAMPDIFF(SECOND, time_in, time_out), 0) END) AS avg_stay_seconds,
              COUNT(CASE WHEN attendance_type = 'manual' AND ${localDay('time_in')} = ? THEN 1 END) AS manual_today
         FROM (${VISITS_SQL}) v`,
      [today, today, today, today, today]
    );
    const r = rows[0];

    const { openHour, closeHour, closedWeekdays } = config.library;
    res.set('Cache-Control', 'no-store');
    res.json({
      today,
      hours: { open: openHour, close: closeHour, closedWeekdays },
      visitsToday: Number(r.visits_today),
      insideNow: Number(r.inside_now),
      timedOutToday: Number(r.timed_out_today),
      averageStayMinutes: r.avg_stay_seconds === null ? null : Math.round(Number(r.avg_stay_seconds) / 60),
      manualToday: Number(r.manual_today),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
