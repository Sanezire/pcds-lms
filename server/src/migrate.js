import { query } from './db.js';
import { closingTimeSql } from './attendance.js';
import { config } from './config.js';

const ROLE_COLUMN = `ENUM('admin', 'student', 'super_admin', 'student_assistant') NOT NULL DEFAULT 'student'`;

// Brings a database set up by an older version up to date when the server starts:
// the two new roles and the audit log table. Safe to run every time.
// Student records. Created on first use too, so a database set up before this
// table existed keeps working.
let studentsTableReady = null;
export function ensureStudentsTable() {
  if (!studentsTableReady) {
    studentsTableReady = query(
      `CREATE TABLE IF NOT EXISTS students_data (
         id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
         rfid_number VARCHAR(32)      NULL,
         student_id  VARCHAR(11)      NOT NULL,
         full_name   VARCHAR(100)     NOT NULL,
         course      VARCHAR(100)     NOT NULL,
         gender      ENUM('male', 'female', 'other') NOT NULL,
         year_level  TINYINT UNSIGNED NOT NULL,
         created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         PRIMARY KEY (id),
         UNIQUE KEY uq_students_data_rfid (rfid_number),
         UNIQUE KEY uq_students_data_student (student_id),
         CONSTRAINT chk_students_data_rfid CHECK (rfid_number REGEXP '^[0-9A-Fa-f]+$'),
         CONSTRAINT chk_students_data_student CHECK (student_id REGEXP '^[0-9]{4}-[0-9]{4}-[0-9]$'),
         CONSTRAINT chk_students_data_year CHECK (year_level BETWEEN 1 AND 6)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    )
      .then(async () => {
        const col = await query(
          `SELECT IS_NULLABLE AS n FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'students_data' AND column_name = 'rfid_number'`
        );
        if (col[0] && col[0].n === 'NO') await query('ALTER TABLE students_data MODIFY rfid_number VARCHAR(32) NULL');
      })
      .catch((err) => {
        studentsTableReady = null;
        throw err;
      });
  }
  return studentsTableReady;
}

export async function ensureSchema() {
  const cols = await query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'`
  );
  const hasLibrarian = cols[0] && String(cols[0].t).includes('librarian');
  if (hasLibrarian) await query(`UPDATE users SET role = 'admin' WHERE role = 'librarian'`);
  if (cols[0] && (hasLibrarian || !String(cols[0].t).includes('super_admin'))) {
    await query(`ALTER TABLE users MODIFY role ${ROLE_COLUMN}`);
    console.log('Updated the user roles.');
  }

  await query(
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id     BIGINT UNSIGNED NULL,
       user_name   VARCHAR(100)    NOT NULL,
       member_id   VARCHAR(32)     NOT NULL,
       user_role   VARCHAR(32)     NOT NULL,
       action      VARCHAR(40)     NOT NULL,
       details     VARCHAR(500)    NOT NULL DEFAULT '',
       ip_address  VARCHAR(45)     NULL,
       created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       KEY idx_audit_created (created_at),
       KEY idx_audit_user (user_id),
       KEY idx_audit_action (action)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Prepare the student table before migrating attendance.
  await ensureStudentsTable();
  const hasStatus = await query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='students_data' AND column_name='status'");
  if (!hasStatus.length) await query("ALTER TABLE students_data ADD COLUMN status ENUM('active','inactive') NOT NULL DEFAULT 'active'");
  const columns = async (table) => (await query(`SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`, [table])).map((r) => r.COLUMN_NAME);
  const hasTable = async (table) => (await query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table])).length > 0;
  if (!(await hasTable('attendance'))) return;
  let c = await columns('attendance');
  if (c.includes('time_in')) return; // already one row per visit
  const add = async (name, sql) => { if (!c.includes(name)) { await query(sql); c.push(name); } };
  await add('type', "ALTER TABLE attendance ADD COLUMN type ENUM('rfid','manual') NOT NULL DEFAULT 'rfid'");
  await add('student_data_id', 'ALTER TABLE attendance ADD COLUMN student_data_id BIGINT UNSIGNED NULL');
  await add('student_id', 'ALTER TABLE attendance ADD COLUMN student_id VARCHAR(32) NULL');
  await add('student_name', 'ALTER TABLE attendance ADD COLUMN student_name VARCHAR(100) NULL');
  await add('course', 'ALTER TABLE attendance ADD COLUMN course VARCHAR(100) NULL');
  await add('year_level', 'ALTER TABLE attendance ADD COLUMN year_level TINYINT UNSIGNED NULL');
  await add('gender', "ALTER TABLE attendance ADD COLUMN gender ENUM('male','female','other') NULL");
  await add('time_out', 'ALTER TABLE attendance ADD COLUMN time_out DATETIME NULL');
  await add('recorded_by', 'ALTER TABLE attendance ADD COLUMN recorded_by BIGINT UNSIGNED NULL');
  if (c.includes('user_id')) await query(`UPDATE attendance a JOIN users u ON u.id=a.user_id AND u.role='student' JOIN students_data s ON s.student_id=u.member_id SET a.student_data_id=s.id WHERE a.student_data_id IS NULL`);
  if (await hasTable('manual_attendance')) {
    const mc = await columns('manual_attendance');
    if (!mc.includes('year_level')) await query('ALTER TABLE manual_attendance ADD COLUMN year_level TINYINT UNSIGNED NULL');
    await query(`INSERT IGNORE INTO attendance (id,type,student_id,student_name,course,year_level,gender,action,recorded_at,time_out,recorded_by)
      SELECT id,'manual',student_id,student_name,course,year_level,gender,'in',time_in,time_out,recorded_by FROM manual_attendance`);
    // ID collisions with old RFID tap IDs get a fresh attendance ID. Match the
    // copied payload on retries so the fallback insert is idempotent.
    await query(`INSERT INTO attendance (type,student_id,student_name,course,year_level,gender,action,recorded_at,time_out,recorded_by)
      SELECT 'manual',m.student_id,m.student_name,m.course,m.year_level,m.gender,'in',m.time_in,m.time_out,m.recorded_by
        FROM manual_attendance m LEFT JOIN attendance a ON a.type='manual' AND a.student_id=m.student_id
          AND a.student_name=m.student_name AND a.recorded_at=m.time_in AND a.time_out <=> m.time_out
       WHERE a.id IS NULL`);
    const [[{ n: oldCount }]] = await query('SELECT COUNT(*) AS n FROM manual_attendance');
    const [[{ n: newCount }]] = await query("SELECT COUNT(*) AS n FROM attendance WHERE type='manual'");
    if (Number(newCount) < Number(oldCount)) throw new Error('Manual attendance migration incomplete; source table retained for recovery.');
    await query('DROP TABLE manual_attendance');
  }
  for (const fk of ['fk_attendance_user','fk_attendance_kiosk']) {
    const found = await query('SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name=\'attendance\' AND constraint_name=?', [fk]);
    if (found.length) await query(`ALTER TABLE attendance DROP FOREIGN KEY ${fk}`);
  }
  for (const idx of ['idx_attendance_user_time','idx_attendance_type_time','idx_attendance_student_time','idx_attendance_time','idx_attendance_manual_student_time']) {
    const found = await query('SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=\'attendance\' AND index_name=?', [idx]);
    if (!found.length && idx.startsWith('idx_attendance_')) continue;
    if (['idx_attendance_user_time'].includes(idx) && found.length) await query(`ALTER TABLE attendance DROP INDEX ${idx}`);
  }
  c = await columns('attendance');
  if (c.includes('kiosk_user_id')) await query('ALTER TABLE attendance DROP COLUMN kiosk_user_id');
  if (c.includes('user_id')) await query('ALTER TABLE attendance DROP COLUMN user_id');
  const typeIndex = await query("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='attendance' AND index_name='idx_attendance_type_time'");
  if (!typeIndex.length) await query('CREATE INDEX idx_attendance_type_time ON attendance (type, recorded_at)');
  const hasStudentFk = await query("SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='attendance' AND constraint_name='fk_attendance_student'");
  if (!hasStudentFk.length) await query('ALTER TABLE attendance ADD CONSTRAINT fk_attendance_student FOREIGN KEY (student_data_id) REFERENCES students_data(id) ON DELETE RESTRICT');

  // Manual entries made before the year level existed take it from the matching
  // student record (same Student ID). Entries with no matching record stay blank.
  const filled = await query(
    `UPDATE attendance a JOIN students_data s ON s.student_id = a.student_id
        SET a.year_level = s.year_level
      WHERE a.type = 'manual' AND a.year_level IS NULL`
  );
  if (filled.affectedRows) console.log(`Filled in the year level of ${filled.affectedRows} manual attendance entries.`);

  await convertToVisits();
}

// Attendance used to be one row per kiosk tap (action 'in'/'out') plus manual rows
// that kept their own copy of the student's details. It is now one row per visit
// linked to students_data. The old rows are converted once, here:
//   - each kiosk Time In is paired with the student's next tap; an 'out' tap closes it;
//   - manual entries are linked to the student record with the same Student ID;
//   - a visit left open on an earlier day is closed at that day's closing time, and
//     if a student still has more than one open visit, all but the latest are closed
//     when the next one starts.
// Rows that belong to no student record (old staff-account taps, manual entries for
// IDs that are not in the records) cannot be kept and are reported.
async function convertToVisits() {
  await query('DROP TABLE IF EXISTS attendance_visits');
  await query(
    `CREATE TABLE attendance_visits (
       id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       student_data_id BIGINT UNSIGNED NOT NULL,
       type            ENUM('rfid', 'manual') NOT NULL,
       time_in         DATETIME        NOT NULL,
       time_out        DATETIME        NULL,
       PRIMARY KEY (id),
       KEY idx_attendance_time_in (time_in),
       KEY idx_attendance_student_time_in (student_data_id, time_in),
       KEY idx_attendance_type_time_in (type, time_in),
       CONSTRAINT fk_attendance_student_data FOREIGN KEY (student_data_id) REFERENCES students_data (id) ON DELETE RESTRICT
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await query(
    `INSERT INTO attendance_visits (student_data_id, type, time_in, time_out)
     SELECT student_data_id, type, time_in, time_out FROM (
       SELECT t.student_data_id, 'rfid' AS type, t.recorded_at AS time_in,
              CASE WHEN t.next_action = 'out' THEN t.next_at END AS time_out, t.id AS old_id
         FROM (SELECT id, student_data_id, action, recorded_at,
                      LEAD(action) OVER (PARTITION BY student_data_id ORDER BY recorded_at, id) AS next_action,
                      LEAD(recorded_at) OVER (PARTITION BY student_data_id ORDER BY recorded_at, id) AS next_at
                 FROM attendance WHERE type = 'rfid' AND student_data_id IS NOT NULL) t
        WHERE t.action = 'in'
       UNION ALL
       SELECT COALESCE(a.student_data_id, s.id), 'manual', a.recorded_at, a.time_out, a.id
         FROM attendance a LEFT JOIN students_data s ON s.student_id = a.student_id
        WHERE a.type = 'manual' AND COALESCE(a.student_data_id, s.id) IS NOT NULL
     ) v
     ORDER BY time_in, old_id`
  );

  const [lost] = await query(
    `SELECT
       (SELECT COUNT(*) FROM attendance WHERE type = 'rfid' AND action = 'in' AND student_data_id IS NULL) AS taps,
       (SELECT COUNT(*) FROM attendance a LEFT JOIN students_data s ON s.student_id = a.student_id
         WHERE a.type = 'manual' AND a.student_data_id IS NULL AND s.id IS NULL) AS manual`
  );

  // Close visits left open on an earlier day.
  const offset = Math.trunc(config.attendance.utcOffsetMinutes);
  const today = new Date(Date.now() + offset * 60000).toISOString().slice(0, 10);
  await query(
    `UPDATE attendance_visits SET time_out = ${closingTimeSql('time_in')}
      WHERE time_out IS NULL
        AND DATE(DATE_ADD(time_in, INTERVAL ${offset} MINUTE)) < ?`,
    [today]
  );
  // One open visit per student: an older open one ends when the next one starts.
  const open = await query('SELECT id, student_data_id, time_in FROM attendance_visits WHERE time_out IS NULL ORDER BY student_data_id, time_in, id');
  for (let i = 0; i + 1 < open.length; i += 1) {
    if (open[i].student_data_id === open[i + 1].student_data_id) {
      await query('UPDATE attendance_visits SET time_out = ? WHERE id = ?', [open[i + 1].time_in, open[i].id]);
    }
  }

  const [counts] = await query('SELECT COUNT(*) AS n FROM attendance_visits');
  await query('RENAME TABLE attendance TO attendance_old_layout, attendance_visits TO attendance');
  await query('DROP TABLE attendance_old_layout');
  console.log(`Converted attendance to one row per visit: ${counts.n} visits.`);
  const dropped = Number(lost.taps) + Number(lost.manual);
  if (dropped) {
    console.log(
      `Left out ${dropped} old entries with no matching student record (${lost.taps} staff-account taps, ${lost.manual} manual entries).`
    );
  }
}
