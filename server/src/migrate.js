import { query } from './db.js';

const ROLE_COLUMN = `ENUM('admin', 'librarian', 'student', 'super_admin', 'student_assistant') NOT NULL DEFAULT 'student'`;

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
         rfid_number VARCHAR(32)      NOT NULL,
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
    ).catch((err) => {
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
  if (cols[0] && !String(cols[0].t).includes('super_admin')) {
    await query(`ALTER TABLE users MODIFY role ${ROLE_COLUMN}`);
    console.log('Added the super_admin and student_assistant roles.');
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

  // Student attendance is stored against the student record, so students no longer
  // need an account in the users table. Older databases get the new column, and any
  // attendance already recorded under an automatically created student account is
  // moved over to the matching student record. Safe to run every time.
  await ensureStudentsTable();
  const hasColumn = await query(
    `SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'attendance' AND column_name = 'student_data_id'`
  );
  if (!hasColumn.length) {
    await query(
      `ALTER TABLE attendance
         MODIFY user_id BIGINT UNSIGNED NULL,
         ADD COLUMN student_data_id BIGINT UNSIGNED NULL AFTER user_id,
         ADD KEY idx_attendance_student_time (student_data_id, recorded_at),
         ADD CONSTRAINT fk_attendance_student FOREIGN KEY (student_data_id) REFERENCES students_data (id) ON DELETE RESTRICT`
    );
    console.log('Attendance can now be stored against student records.');
  }
  const moved = await query(
    `UPDATE attendance a
       JOIN users u ON u.id = a.user_id AND u.role = 'student'
       JOIN students_data s ON s.student_id = u.member_id
        SET a.student_data_id = s.id, a.user_id = NULL`
  );
  if (moved.affectedRows) {
    console.log(`Moved ${moved.affectedRows} attendance records from student accounts to student records.`);
  }
}
