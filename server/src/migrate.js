import { query } from './db.js';

const ROLE_COLUMN = `ENUM('admin', 'librarian', 'student', 'super_admin', 'student_assistant') NOT NULL DEFAULT 'student'`;

// Brings a database set up by an older version up to date when the server starts:
// the two new roles and the audit log table. Safe to run every time.
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
}
