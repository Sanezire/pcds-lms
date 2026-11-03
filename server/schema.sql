CREATE DATABASE IF NOT EXISTS pcds_lms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pcds_lms;

CREATE TABLE IF NOT EXISTS users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name         VARCHAR(100)    NOT NULL,
  email             VARCHAR(255)    NOT NULL,
  member_id         VARCHAR(32)     NOT NULL,
  password_hash     VARCHAR(255)    NOT NULL,
  role              ENUM('admin', 'student', 'super_admin', 'student_assistant') NOT NULL DEFAULT 'student',
  status            ENUM('active', 'suspended', 'pending') NOT NULL DEFAULT 'active',
  last_login_at     DATETIME        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_member_id (member_id),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored,
-- so a database leak cannot be replayed as a valid session.
CREATE TABLE IF NOT EXISTS sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  ip_address  VARCHAR(45)     NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Student records used by the kiosk. A card tap sends the RFID number, which is
-- looked up here to find the student. RFID numbers are hexadecimal (uppercase),
-- and student IDs look like 2025-1042-3 (YYYY-XXXX-X).
CREATE TABLE IF NOT EXISTS students_data (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  rfid_number VARCHAR(32)      NULL,
  student_id  VARCHAR(11)      NOT NULL,
  full_name   VARCHAR(100)     NOT NULL,
  course      VARCHAR(100)     NOT NULL,
  gender      ENUM('male', 'female', 'other') NOT NULL,
  year_level  TINYINT UNSIGNED NOT NULL,
  status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_data_rfid (rfid_number),
  UNIQUE KEY uq_students_data_student (student_id),
  CONSTRAINT chk_students_data_rfid CHECK (rfid_number REGEXP '^[0-9A-Fa-f]+$'),
  CONSTRAINT chk_students_data_student CHECK (student_id REGEXP '^[0-9]{4}-[0-9]{4}-[0-9]$'),
  CONSTRAINT chk_students_data_year CHECK (year_level BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Unified student attendance. RFID visits use one row per tap; manual visits use
-- one row with recorded_at as Time In and time_out as Time Out.
CREATE TABLE IF NOT EXISTS attendance (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type           ENUM('rfid', 'manual') NOT NULL,
  student_data_id BIGINT UNSIGNED NULL,
  student_id     VARCHAR(32) NULL,
  student_name   VARCHAR(100) NULL,
  course         VARCHAR(100) NULL,
  year_level     TINYINT UNSIGNED NULL,
  gender         ENUM('male', 'female', 'other') NULL,
  action         ENUM('in', 'out') NOT NULL,
  recorded_at    DATETIME        NOT NULL,
  time_out       DATETIME        NULL,
  recorded_by    BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_attendance_type_time (type, recorded_at),
  KEY idx_attendance_student_time (student_data_id, recorded_at),
  KEY idx_attendance_time (recorded_at),
  KEY idx_attendance_manual_student_time (student_id, recorded_at),
  UNIQUE KEY uq_attendance_active_manual (student_id, type, time_out),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_data_id) REFERENCES students_data (id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_attendance_method CHECK ((type = 'rfid' AND student_data_id IS NOT NULL) OR (type = 'manual' AND student_id IS NOT NULL AND student_name IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom messages shown on the kiosk when a specific student ID is scanned:
-- one for Time In and one for Time Out.
CREATE TABLE IF NOT EXISTS message_rules (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id  VARCHAR(32)     NOT NULL,
  message     VARCHAR(500)    NOT NULL,                -- shown on Time In ('' = none)
  message_out VARCHAR(500)    NOT NULL DEFAULT '',     -- shown on Time Out ('' = none)
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_rules_student (student_id),
  CONSTRAINT fk_message_rules_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages sent straight to the kiosk from the dashboard. The kiosk picks up
-- each new row once and shows it.
CREATE TABLE IF NOT EXISTS kiosk_broadcasts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message     VARCHAR(500)    NOT NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kiosk_broadcasts_created (created_at),
  CONSTRAINT fk_kiosk_broadcasts_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One message that stays on the kiosk until staff switch it off. At most one
-- row exists (id is always 1); no row means nothing is pinned.
CREATE TABLE IF NOT EXISTS kiosk_pinned (
  id          TINYINT UNSIGNED NOT NULL,
  message     VARCHAR(500)     NOT NULL,
  created_by  BIGINT UNSIGNED  NULL,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log: one row per action by an admin, student assistant or super admin.
-- The name, ID and role are copied into the row so the record stays readable even
-- if the account is changed later. Rows are only ever added, never edited or removed.
CREATE TABLE IF NOT EXISTS audit_logs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
