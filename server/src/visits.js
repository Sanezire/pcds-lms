// Every visit as one row, from both sources.
//  - RFID taps are stored one row per tap, so each 'in' tap is paired with the
//    very next tap by the same student. If that next tap is an 'out' it closes
//    the visit; otherwise (no later tap, or another 'in') the visit is still open.
//  - Manual rows already hold Time In and Time Out together.
// Taps by staff point at a user account and taps by students at a student record;
// either way the name and ID shown come from whichever one the tap belongs to.
// Course, gender and year level of an RFID visit come from the student's record;
// taps by staff accounts have none.
//
// visitsSql(fromDay, toDay) only reads rows recorded around those school days
// ('YYYY-MM-DD', the school's local days), which is much faster on a large table.
// The window starts a day early and ends two days late so a visit near the edge
// is still paired with its Time Out; callers still filter by the exact day.
import { config } from './config.js';

const OFFSET_MIN = Math.trunc(config.attendance.utcOffsetMinutes);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function bound(day, addDays) {
  if (!DAY.test(day)) throw new Error(`Invalid day ${day}`);
  const t = Date.parse(`${day}T00:00:00Z`) + addDays * 86_400_000 - OFFSET_MIN * 60_000;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

export function visitsSql(fromDay = null, toDay = null) {
  // The bounds are built here from checked dates, never from user text.
  const lo = fromDay ? ` AND recorded_at >= '${bound(fromDay, -1)}'` : '';
  const hi = toDay ? ` AND recorded_at < '${bound(toDay, 3)}'` : '';
  return VISITS_TEMPLATE.replaceAll('/*RANGE*/', lo + hi);
}

const VISITS_TEMPLATE = `
  SELECT 'rfid' AS attendance_type,
         t.id AS source_id,
         s.full_name AS student_name,
         s.student_id AS student_id,
         CAST(s.course AS CHAR(100)) AS course,
         CAST(s.gender AS CHAR(10)) AS gender,
         CAST(s.year_level AS UNSIGNED) AS year_level,
         t.recorded_at AS time_in,
         CASE WHEN t.next_action = 'out' THEN t.next_at END AS time_out
    FROM (
      SELECT id, student_data_id, action, recorded_at,
             LEAD(action) OVER (PARTITION BY student_data_id ORDER BY recorded_at, id) AS next_action,
             LEAD(recorded_at) OVER (PARTITION BY student_data_id ORDER BY recorded_at, id) AS next_at
        FROM attendance WHERE type = 'rfid'/*RANGE*/
    ) t
    LEFT JOIN students_data s ON s.id = t.student_data_id
   WHERE t.action = 'in'
  UNION ALL
  SELECT 'manual', m.id, m.student_name, m.student_id,
         CAST(m.course AS CHAR(100)), CAST(m.gender AS CHAR(10)), CAST(m.year_level AS UNSIGNED), m.recorded_at, m.time_out
    FROM attendance m WHERE m.type = 'manual'/*RANGE*/
`;

export const VISITS_SQL = visitsSql();
