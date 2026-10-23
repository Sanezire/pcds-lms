import 'dotenv/config';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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
    ttlHours: num(process.env.SESSION_TTL_HOURS, 8),
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  // Shared secret required to create an administrator account at /register.
  // When empty, admin registration is switched off entirely.
  adminRegistrationKey: (process.env.ADMIN_REGISTRATION_KEY || '').trim(),
};

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  LIBRARIAN: 'librarian',
  STUDENT: 'student',
});

export const STATUSES = Object.freeze(['active', 'suspended', 'pending']);
