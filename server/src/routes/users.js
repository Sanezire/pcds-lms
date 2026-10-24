import { Router } from 'express';
import { query } from '../db.js';
import { ROLES, STATUSES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { destroyUserSessions, toPublicUser } from '../sessions.js';
import { publish, TOPICS } from '../events.js';

const router = Router();

router.use(requireAuth);

// Admins and librarians can see the account list.
router.get('/users', requireRole(ROLES.ADMIN, ROLES.LIBRARIAN), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, full_name, email, member_id, role, status, created_at
         FROM users
        ORDER BY created_at DESC
        LIMIT 200`
    );
    res.json({ users: rows.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
});

// Only admins can change roles or account status. This is the only way to
// create librarians and admins; registration at /register always creates administrators.
router.patch('/users/:id', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid user.');

    const { role, status } = req.body || {};
    const sets = [];
    const params = [];

    if (role !== undefined) {
      if (!Object.values(ROLES).includes(role)) throw httpError(400, 'Invalid role.');
      sets.push('role = ?');
      params.push(role);
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
      sets.push('status = ?');
      params.push(status);
    }
    if (!sets.length) throw httpError(400, 'Nothing to update.');

    if (id === req.user.id) {
      throw httpError(400, 'You cannot change your own role or status.');
    }

    const result = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (!result.affectedRows) throw httpError(404, 'User not found.');

    // Force the user to sign in again so the new role or status applies immediately.
    await destroyUserSessions(id);
    publish(TOPICS.USERS);

    res.json({ message: 'User updated.' });
  } catch (err) {
    next(err);
  }
});

export default router;
