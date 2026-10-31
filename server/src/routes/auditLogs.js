import { Router } from 'express';
import { query } from '../db.js';
import { ROLES, config, AUDITED_ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { recordAudit } from '../audit.js';

const router = Router();

// Only a super admin can read or delete the audit log, and entries can never be
// edited. Every deletion leaves one new entry behind saying who deleted what.
router.use(requireAuth, requireRole(ROLES.SUPER_ADMIN));

const PAGE_SIZES = [10, 25, 50, 100];
const CATEGORIES = ['auth', 'account', 'attendance', 'student', 'message', 'audit'];
const MAX_DELETE_IDS = 1000;

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

// Deletes the selected entries ({ ids: [...] }) or every entry ({ all: true }).
router.delete('/', async (req, res, next) => {
  try {
    const { ids, all } = req.body || {};
    let deleted;
    let details;

    if (all === true) {
      const result = await query('DELETE FROM audit_logs');
      deleted = result.affectedRows;
      details = `Deleted all audit logs (${deleted} ${deleted === 1 ? 'entry' : 'entries'}).`;
    } else {
      if (!Array.isArray(ids) || ids.length === 0) throw httpError(400, 'Select at least one entry to delete.');
      if (ids.length > MAX_DELETE_IDS) throw httpError(400, `Select up to ${MAX_DELETE_IDS} entries at a time.`);
      const clean = [...new Set(ids)];
      if (!clean.every((id) => Number.isSafeInteger(id) && id > 0)) throw httpError(400, 'Invalid selection.');
      const result = await query(`DELETE FROM audit_logs WHERE id IN (${clean.map(() => '?').join(',')})`, clean);
      deleted = result.affectedRows;
      details = `Deleted ${deleted} selected ${deleted === 1 ? 'entry' : 'entries'}.`;
    }

    if (deleted > 0) await recordAudit(req, 'audit.delete', details);
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

export default router;
