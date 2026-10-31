// Every visit as one row, from both sources.
//  - RFID taps are stored one row per tap, so each 'in' tap is paired with the
//    very next tap by the same student. If that next tap is an 'out' it closes
//    the visit; otherwise (no later tap, or another 'in') the visit is still open.
//  - Manual rows already hold Time In and Time Out together.
// Taps by staff point at a user account and taps by students at a student record;
// either way the name and ID shown come from whichever one the tap belongs to.
// RFID rows carry no course or gender, as before.
export const VISITS_SQL = `
  SELECT 'rfid' AS attendance_type,
         t.id AS source_id,
         COALESCE(s.full_name, u.full_name) AS student_name,
         COALESCE(s.student_id, u.member_id) AS student_id,
         CAST(NULL AS CHAR(100)) AS course,
         CAST(NULL AS CHAR(10)) AS gender,
         t.recorded_at AS time_in,
         CASE WHEN t.next_action = 'out' THEN t.next_at END AS time_out
    FROM (
      SELECT id, user_id, student_data_id, action, recorded_at,
             LEAD(action) OVER (PARTITION BY user_id, student_data_id ORDER BY recorded_at, id) AS next_action,
             LEAD(recorded_at) OVER (PARTITION BY user_id, student_data_id ORDER BY recorded_at, id) AS next_at
        FROM attendance
    ) t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN students_data s ON s.id = t.student_data_id
   WHERE t.action = 'in'
  UNION ALL
  SELECT 'manual', m.id, m.student_name, m.student_id,
         CAST(m.course AS CHAR(100)), CAST(m.gender AS CHAR(10)), m.time_in, m.time_out
    FROM manual_attendance m
`;
