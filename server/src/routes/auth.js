import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { config } from '../config.js';
import { recordAudit } from '../audit.js';
import {
  validateRegistration,
  validateLogin,
  normalizeEmail,
  normalizeMemberId,
} from '../validation.js';
import {
  createSession,
  findSessionUser,
  destroySession,
  cookieOptions,
  toPublicUser,
} from '../sessions.js';
import { httpError } from '../middleware/auth.js';
import {
  loginIpLimiter,
  loginIdentifierLimiter,
  registerLimiter,
} from '../middleware/rateLimit.js';

const router = Router();

const ROLE_LABEL = { admin: 'Administrator', student_assistant: 'Student Assistant' };

// Compare hashes of both values so the check takes the same time whatever the input.
function keyMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// A real bcrypt hash of a random string. Comparing against it when no user is
// found keeps response time similar whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('pcds-lms-dummy-password', config.bcryptRounds);

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { errors, values } = validateRegistration(req.body);
    if (Object.keys(errors).length) {
      throw httpError(400, 'Check the highlighted fields and try again.', errors);
    }

    // Only people holding the server-side registration key can create accounts.
    // This runs before any database lookup so it cannot be used to probe for
    // existing emails or IDs.
    if (!config.adminRegistrationKey) {
      throw httpError(503, 'Registration is turned off. Set ADMIN_REGISTRATION_KEY on the server to enable it.');
    }
    if (!keyMatches(values.registrationKey, config.adminRegistrationKey)) {
      throw httpError(403, 'The registration key is incorrect.', {
        registrationKey: 'The registration key is incorrect.',
      });
    }

    const existing = await query(
      'SELECT email, member_id FROM users WHERE email = ? OR member_id = ? LIMIT 2',
      [values.email, values.memberId]
    );
    const conflicts = {};
    for (const row of existing) {
      if (row.email === values.email) conflicts.email = 'An account with this email already exists.';
      if (row.member_id === values.memberId) conflicts.memberId = 'An account with this ID already exists.';
    }
    if (Object.keys(conflicts).length) {
      throw httpError(409, 'That email or ID is already registered.', conflicts);
    }

    const passwordHash = await bcrypt.hash(values.password, config.bcryptRounds);

    try {
      // The role is limited to the registerable ones (validated above), never a
      // super admin. Status is fixed server-side.
      const created = await query(
        `INSERT INTO users (full_name, email, member_id, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [values.fullName, values.email, values.memberId, passwordHash, values.role]
      );
      await recordAudit(
        req,
        'account.register',
        `Registered ${values.role === 'admin' ? 'an' : 'a'} ${ROLE_LABEL[values.role]} account`,
        { id: created.insertId, full_name: values.fullName, member_id: values.memberId, role: values.role }
      );
    } catch (err) {
      // Two simultaneous registrations can pass the check above; the unique keys still win.
      if (err.code === 'ER_DUP_ENTRY') {
        const fields = String(err.sqlMessage).includes('uq_users_member_id')
          ? { memberId: 'An account with this ID already exists.' }
          : { email: 'An account with this email already exists.' };
        throw httpError(409, 'That email or ID is already registered.', fields);
      }
      throw err;
    }

    res.status(201).json({ message: `${ROLE_LABEL[values.role]} account created. You can sign in now.` });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginIpLimiter, loginIdentifierLimiter, async (req, res, next) => {
  try {
    const { errors, values } = validateLogin(req.body);
    if (Object.keys(errors).length) {
      throw httpError(400, 'Check the highlighted fields and try again.', errors);
    }

    const isEmail = values.identifier.includes('@');
    const rows = await query(
      isEmail
        ? 'SELECT * FROM users WHERE email = ? LIMIT 1'
        : 'SELECT * FROM users WHERE member_id = ? LIMIT 1',
      [isEmail ? normalizeEmail(values.identifier) : normalizeMemberId(values.identifier)]
    );
    const user = rows[0];

    const passwordOk = await bcrypt.compare(values.password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      if (user) await recordAudit(req, 'auth.login_failed', 'Incorrect password', user);
      throw httpError(401, 'Incorrect email, ID or password.');
    }

    if (user.status === 'suspended') {
      throw httpError(403, 'This account has been suspended. Contact the library administrator.');
    }
    if (user.status === 'pending') {
      throw httpError(403, 'This account is waiting for approval.');
    }

    const token = await createSession(user.id, req, values.remember);
    await query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);

    await recordAudit(req, 'auth.login', 'Signed in', user);

    res.cookie(config.session.cookieName, token, cookieOptions(values.remember));
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[config.session.cookieName];
    if (token && typeof token === 'string') {
      const who = await findSessionUser(token);
      if (who) await recordAudit(req, 'auth.logout', 'Signed out', who);
      await destroySession(token);
    }
    res.clearCookie(config.session.cookieName, { path: '/' });
    res.json({ message: 'Signed out.' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies?.[config.session.cookieName];
    const user = token && typeof token === 'string' ? await findSessionUser(token) : null;

    if (!user || user.status !== 'active') {
      if (token) res.clearCookie(config.session.cookieName, { path: '/' });
      return res.json({ user: null });
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
