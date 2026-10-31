import 'dotenv/config';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Minutes ahead of UTC for the school's local time (Philippines = 480).
// Decides where one attendance day ends and the next begins.
const utcOffset = Number.parseInt(process.env.ATTENDANCE_UTC_OFFSET_MINUTES ?? '480', 10);

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: num(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === '1',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'pcds_lms',
  },
  session: {
    cookieName: process.env.COOKIE_NAME || 'pcds_sid',
    // Normal sign-in: lasts this long and the cookie is dropped when the browser closes.
    ttlHours: num(process.env.SESSION_TTL_HOURS, 8),
    // "Remember me" sign-in: a persistent cookie that lasts this many days.
    rememberTtlDays: num(process.env.REMEMBER_TTL_DAYS, 30),
  },
  attendance: {
    utcOffsetMinutes: Number.isFinite(utcOffset) ? utcOffset : 480,
  },
  // Optional shared key for the public kiosk screen. When set, the kiosk must
  // present it (open /kiosk?key=... once on the kiosk device). When empty, the
  // kiosk is open to anyone who can reach the site.
  kiosk: {
    key: (process.env.KIOSK_KEY || '').trim(),
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  // Shared secret required to create an administrator account at /register.
  // When empty, admin registration is switched off entirely.
  adminRegistrationKey: (process.env.ADMIN_REGISTRATION_KEY || '').trim(),
};

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  LIBRARIAN: 'librarian',
  STUDENT_ASSISTANT: 'student_assistant',
  STUDENT: 'student',
});

// Who may do what. Super admins can do everything admins can, plus read the audit log.
// A student assistant (SA) can only use Manual Attendance.
export const MANAGER_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.LIBRARIAN]);
export const ATTENDANCE_ROLES = Object.freeze([...MANAGER_ROLES, ROLES.STUDENT_ASSISTANT]);
// Roles whose actions are written to the audit log.
export const AUDITED_ROLES = ATTENDANCE_ROLES;
// Roles that can be chosen on the public /register page (never a super admin).
export const REGISTERABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.STUDENT_ASSISTANT]);

export const STATUSES = Object.freeze(['active', 'suspended', 'pending']);
