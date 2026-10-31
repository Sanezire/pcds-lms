import { Router } from 'express';
import { query } from '../db.js';
import { ROLES, config, AUDITED_ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';

const router = Router();

// The audit log can only be read, and only by a super admin. There is no way
// to edit or delete an entry through the API.
router.use(requireAuth, requireRole(ROLES.SUPER_ADMIN));

const PAGE_SIZES = [10, 25, 50, 100];
const CATEGORIES = ['auth', 'account', 'attendance', 'student', 'message'];

// A school-local calendar day (YYYY-MM-DD) as a UTC instant.
function dayStart(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw httpError(400, `${label} is not a valid date.`);
  }
  return new Date(Date.parse(`${value}T00:00:00Z`) - config.attendance.utcOffsetMinutes * 60 * 1000);
}

router.get('/', async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const q = req.query;

    if (q.role) {
      if (!AUDITED_ROLES.includes(q.role)) throw httpError(400, 'Invalid role filter.');
      where.push('user_role = ?');
      params.push(q.role);
    }
    if (q.category) {
      if (!CATEGORIES.includes(q.category)) throw httpError(400, 'Invalid action filter.');
      where.push("action LIKE ? ESCAPE '|'");
      params.push(`${q.category}.%`);
    }
    if (q.from) {
      where.push('created_at >= ?');
      params.push(dayStart(q.from, 'Start date'));
    }
    if (q.to) {
      where.push('created_at < ?');
      params.push(new Date(dayStart(q.to, 'End date').getTime() + 24 * 60 * 60 * 1000));
    }
    const term = typeof q.q === 'string' ? q.q.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (term) {
      const like = `%${term.replace(/[|%_]/g, '|$&')}%`;
      where.push("(user_name LIKE ? ESCAPE '|' OR member_id LIKE ? ESCAPE '|' OR details LIKE ? ESCAPE '|')");
      params.push(like, like, like);
    }

    const pageSize = PAGE_SIZES.includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM audit_logs ${clause}`, params);
    const rows = await query(
      `SELECT id, user_name, member_id, user_role, action, details, ip_address, created_at
         FROM audit_logs ${clause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      total: Number(total),
      page,
      pageSize,
      logs: rows.map((r) => ({
        id: r.id,
        at: new Date(r.created_at).toISOString(),
        userName: r.user_name,
        memberId: r.member_id,
        role: r.user_role,
        action: r.action,
        details: r.details,
        ip: r.ip_address,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
