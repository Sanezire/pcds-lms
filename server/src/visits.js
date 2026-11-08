// Every visit as one row, with the student's details from students_data.
// attendance already holds one row per visit (Time In and Time Out together),
// whether it was a kiosk card tap ('rfid') or entered by staff ('manual').
//
// visitsSql(fromDay, toDay) only reads visits that started around those school
// days ('YYYY-MM-DD', the school's local days), which is much faster on a large
// table. Callers still filter by the exact day.
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
  const range = [
    fromDay ? `a.time_in >= '${bound(fromDay, -1)}'` : '',
    toDay ? `a.time_in < '${bound(toDay, 2)}'` : '',
  ].filter(Boolean);
  return `
  SELECT CAST(a.type AS CHAR(10)) AS attendance_type,
         a.id AS source_id,
         s.full_name AS student_name,
         s.student_id AS student_id,
         CAST(s.course AS CHAR(100)) AS course,
         CAST(s.gender AS CHAR(10)) AS gender,
         CAST(s.year_level AS UNSIGNED) AS year_level,
         a.time_in AS time_in,
         a.time_out AS time_out
    FROM attendance a
    JOIN students_data s ON s.id = a.student_data_id
   ${range.length ? `WHERE ${range.join(' AND ')}` : ''}
`;
}

export const VISITS_SQL = visitsSql();
