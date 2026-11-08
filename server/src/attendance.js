import { config } from './config.js';

// Shared rules for attendance visits (one row per visit: time_in, time_out).

const OFFSET_MS = Math.trunc(config.attendance.utcOffsetMinutes) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Start of the school's current local day, as a UTC Date.
export function startOfLocalDay(nowMs = Date.now()) {
  return new Date(Math.floor((nowMs + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
}

// SQL for the library's closing time on the local day of `col` (a UTC DATETIME),
// never earlier than `col` itself. Used to close a visit left open on an earlier day.
// Every number comes from the server configuration, never from user input.
export function closingTimeSql(col) {
  const off = Math.trunc(config.attendance.utcOffsetMinutes);
  const closeMin = config.library.closeHour * 60;
  return `GREATEST(${col}, DATE_ADD(DATE(DATE_ADD(${col}, INTERVAL ${off} MINUTE)), INTERVAL ${closeMin - off} MINUTE))`;
}

// Lock the student's record for the rest of the transaction, so two taps or
// submissions for the same student are handled one after the other.
export async function lockStudent(tx, studentDataId) {
  await tx.query('SELECT id FROM students_data WHERE id = ? FOR UPDATE', [studentDataId]);
}

// A visit left open on an earlier day (the student never timed out) is closed at
// that day's closing time, so it cannot block today's Time In.
export async function closeStaleVisits(tx, studentDataId, nowMs = Date.now()) {
  await tx.query(
    `UPDATE attendance SET time_out = ${closingTimeSql('time_in')}
      WHERE student_data_id = ? AND time_out IS NULL AND time_in < ?`,
    [studentDataId, startOfLocalDay(nowMs)]
  );
}

// The student's visit that is still open (at most one), or undefined.
export async function findOpenVisit(tx, studentDataId) {
  const rows = await tx.query(
    'SELECT id, type, time_in FROM attendance WHERE student_data_id = ? AND time_out IS NULL ORDER BY time_in DESC, id DESC LIMIT 1',
    [studentDataId]
  );
  return rows[0];
}
