import { Router } from 'express';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { recordAudit } from '../audit.js';
import { validateNewAccount } from '../validation.js';
import { createStaffAccount, ROLE_LABEL } from '../accounts.js';
import { destroyUserSessions } from '../sessions.js';

const router = Router();

// Account Management is for the super admin only, and only covers admin and
// student assistant accounts (never super admins).
router.use(requireAuth, requireRole(ROLES.SUPER_ADMIN));

const STAFF = ['admin', 'student_assistant'];
const PAGE_SIZES = [10, 25, 50, 100];
const iso = (d) => (d ? new Date(d).toISOString() : null);

function toAccount(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    memberId: r.member_id,
    role: r.role,
    status: r.status === 'active' ? 'active' : 'inactive',
    lastLoginAt: iso(r.last_login_at),
    createdAt: iso(r.created_at),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const where = [`role IN ('admin', 'student_assistant')`];
    const params = [];
    const search = typeof q.q === 'string' ? q.q.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (search) {
      const like = `%${search.replace(/[|%_]/g, '|$&')}%`;
      where.push(`(full_name LIKE ? ESCAPE '|' OR email LIKE ? ESCAPE '|' OR member_id LIKE ? ESCAPE '|')`);
      params.push(like, like, like);
    }
    if (q.role) {
      if (!STAFF.includes(q.role)) throw httpError(400, 'Invalid role.');
      where.push('role = ?');
      params.push(q.role);
    }
    if (q.status) {
      if (!['active', 'inactive'].includes(q.status)) throw httpError(400, 'Invalid status.');
      where.push(q.status === 'active' ? `status = 'active'` : `status <> 'active'`);
    }
    const pageSize = PAGE_SIZES.includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
    const wanted = /^\d{1,6}$/.test(String(q.page ?? '1')) ? Math.max(Number(q.page ?? 1), 1) : 1;

    const clause = `WHERE ${where.join(' AND ')}`;
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users ${clause}`, params);
    const totalPages = Math.max(Math.ceil(Number(total) / pageSize), 1);
    const page = Math.min(wanted, totalPages);
    const rows = await query(
      `SELECT id, full_name, email, member_id, role, status, last_login_at, created_at FROM users ${clause}
        ORDER BY status = 'active' DESC, role, full_name
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    const [counts] = await query(
      `SELECT SUM(status = 'active') AS active, SUM(status <> 'active') AS inactive,
              SUM(role = 'admin' AND status = 'active') AS admins, SUM(role = 'student_assistant' AND status = 'active') AS assistants
         FROM users WHERE role IN ('admin', 'student_assistant')`
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      accounts: rows.map(toAccount),
      total: Number(total),
      page,
      pageSize,
      totalPages,
      counts: {
        active: Number(counts.active || 0),
        inactive: Number(counts.inactive || 0),
        admins: Number(counts.admins || 0),
        assistants: Number(counts.assistants || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, values } = validateNewAccount(req.body);
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields and try again.', errors);
    const { id, memberId } = await createStaffAccount(values);
    await recordAudit(req, 'account.create', `Created ${values.role === 'admin' ? 'an' : 'a'} ${ROLE_LABEL[values.role]} account for ${values.fullName} (ID ${memberId})`);
    const [row] = await query('SELECT id, full_name, email, member_id, role, status, last_login_at, created_at FROM users WHERE id = ?', [id]);
    res.status(201).json({ account: toAccount(row) });
  } catch (err) {
    next(err);
  }
});

async function findStaff(idParam) {
  const id = Number(idParam);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, 'Invalid account.');
  const [row] = await query(
    `SELECT id, full_name, email, member_id, role, status, last_login_at, created_at FROM users
      WHERE id = ? AND role IN ('admin', 'student_assistant')`,
    [id]
  );
  if (!row) throw httpError(404, 'Account not found.');
  return row;
}

// Deactivated accounts cannot sign in, and anyone signed in with them is signed out.
router.post('/:id/deactivate', async (req, res, next) => {
  try {
    const row = await findStaff(req.params.id);
    if (row.status !== 'active') throw httpError(409, 'This account is already deactivated.');
    await query(`UPDATE users SET status = 'suspended' WHERE id = ?`, [row.id]);
    await destroyUserSessions(row.id);
    await recordAudit(req, 'account.deactivate', `Deactivated the ${ROLE_LABEL[row.role]} account of ${row.full_name} (ID ${row.member_id})`);
    res.json({ account: toAccount({ ...row, status: 'suspended' }) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reactivate', async (req, res, next) => {
  try {
    const row = await findStaff(req.params.id);
    if (row.status === 'active') throw httpError(409, 'This account is already active.');
    await query(`UPDATE users SET status = 'active' WHERE id = ?`, [row.id]);
    await recordAudit(req, 'account.reactivate', `Reactivated the ${ROLE_LABEL[row.role]} account of ${row.full_name} (ID ${row.member_id})`);
    res.json({ account: toAccount({ ...row, status: 'active' }) });
  } catch (err) {
    next(err);
  }
});

// Deleting removes the account for good; audit log entries keep the name and ID
// they were written with, and kiosk messages it created stay without an author.
router.delete('/:id', async (req, res, next) => {
  try {
    const row = await findStaff(req.params.id);
    await query('DELETE FROM users WHERE id = ?', [row.id]);
    await recordAudit(req, 'account.delete', `Deleted the ${ROLE_LABEL[row.role]} account of ${row.full_name} (ID ${row.member_id})`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
