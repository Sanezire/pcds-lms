import crypto from 'node:crypto';
import { query } from './db.js';
import { config } from './config.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const HOUR_MS = 60 * 60 * 1000;

function sessionLifetimeMs(remember) {
  return remember ? config.session.rememberTtlDays * 24 * HOUR_MS : config.session.ttlHours * HOUR_MS;
}

// Without "remember", no maxAge is set, so the browser keeps the cookie only
// until it is closed. With it, the cookie persists for the longer lifetime.
export function cookieOptions(remember = false) {
  const options = {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
  };
  if (remember) options.maxAge = sessionLifetimeMs(true);
  return options;
}

export async function createSession(userId, req, remember = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs(remember));

  await query(
    `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      hashToken(token),
      (req.ip || '').slice(0, 45) || null,
      (req.get('user-agent') || '').slice(0, 255) || null,
      expiresAt,
    ]
  );

  return token;
}

export async function findSessionUser(token) {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.member_id, u.role, u.status, u.created_at,
            s.id AS session_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

export async function destroySession(token) {
  await query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function destroyUserSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
}

export function toPublicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    memberId: row.member_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}
