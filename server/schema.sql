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
  role              ENUM('admin', 'librarian', 'student') NOT NULL DEFAULT 'student',
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

-- Library attendance taps. One row per Time In or Time Out.
CREATE TABLE IF NOT EXISTS attendance (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  action         ENUM('in', 'out') NOT NULL,
  recorded_at    DATETIME        NOT NULL,
  kiosk_user_id  BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_attendance_user_time (user_id, recorded_at),
  KEY idx_attendance_time (recorded_at),
  CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_kiosk FOREIGN KEY (kiosk_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manual attendance for students without an RFID card. One row per visit:
-- time_out stays NULL while the student is still in. active_student_id is
-- the student ID only while time_out is NULL, and its UNIQUE key means the
-- database itself refuses a second open entry for the same student.
CREATE TABLE IF NOT EXISTS manual_attendance (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id        VARCHAR(32)     NOT NULL,
  student_name      VARCHAR(100)    NOT NULL,
  course            VARCHAR(100)    NOT NULL,
  gender            ENUM('male', 'female', 'other') NOT NULL,
  time_in           DATETIME        NOT NULL,
  time_out          DATETIME        NULL,
  recorded_by       BIGINT UNSIGNED NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_student_id VARCHAR(32) GENERATED ALWAYS AS (IF(time_out IS NULL, student_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_manual_attendance_active (active_student_id),
  KEY idx_manual_attendance_time_in (time_in),
  KEY idx_manual_attendance_student (student_id, time_in),
  CONSTRAINT fk_manual_attendance_user FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
