import bcrypt from 'bcrypt';
import { query } from './db.js';
import { config } from './config.js';
import { httpError } from './middleware/auth.js';

// Staff accounts that can be registered or created by the super admin.
export const ROLE_LABEL = { admin: 'Administrator', student_assistant: 'Student Assistant' };

// Account IDs are assigned from the role: AD-0001, AD-0002 ... for admins and
// SA-0001, SA-0002 ... for student assistants. The prefixes are fixed here, so
// they are safe to place in the SQL below.
const ID_PREFIX = { admin: 'AD', student_assistant: 'SA' };

async function nextMemberId(role) {
  const prefix = ID_PREFIX[role];
  const rows = await query(
    `SELECT MAX(CAST(SUBSTRING(member_id, ${prefix.length + 2}) AS UNSIGNED)) AS last
       FROM users WHERE member_id REGEXP '^${prefix}-[0-9]+$'`
  );
  return `${prefix}-${String(Number(rows[0]?.last || 0) + 1).padStart(4, '0')}`;
}

// Creates an active admin or student assistant account and returns { id, memberId }.
// The ID comes from the role, never from the request. Two accounts created at the
// same moment can be offered the same number; the unique key rejects the second,
// which simply takes the next one.
export async function createStaffAccount({ fullName, email, password, role }) {
  if (!ID_PREFIX[role]) throw httpError(400, 'Choose a role.', { role: 'Choose a role.' });
  const existing = await query('SELECT email FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) {
    throw httpError(409, 'That email is already registered.', { email: 'An account with this email already exists.' });
  }
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  for (let attempt = 1; ; attempt += 1) {
    const memberId = await nextMemberId(role);
    try {
      const created = await query(
        `INSERT INTO users (full_name, email, member_id, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [fullName, email, memberId, passwordHash, role]
      );
      return { id: created.insertId, memberId };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      if (!String(err.sqlMessage).includes('uq_users_member_id')) {
        throw httpError(409, 'That email is already registered.', { email: 'An account with this email already exists.' });
      }
      if (attempt >= 5) throw httpError(503, 'Could not assign an ID. Try again.');
    }
  }
}
