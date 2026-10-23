import { Router } from 'express';
import { query } from '../db.js';
import { config, ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';

const router = Router();

const ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const DUPLICATE_WINDOW_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The kiosk screen runs under a signed-in staff session (admin or librarian).
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

// Start of the current attendance day (local midnight) expressed in UTC.
function startOfLocalDayUtc(nowMs) {
  const offsetMs = config.attendance.utcOffsetMinutes * 60 * 1000;
  return new Date(Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs);
}

// Records one card tap. The first tap of the day is Time In, the next is
// Time Out, and so on. Every failure returns the same generic message so the
// screen never reveals whether an ID exists or what state an account is in.
router.post('/scan', async (req, res, next) => {
  try {
    const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
    if (!ID_PATTERN.test(studentId)) throw httpError(400, 'Scan failed.');

    const found = await query(
      `SELECT id, member_id FROM users WHERE member_id = ? AND status = 'active' LIMIT 1`,
      [studentId]
    );
    const student = found[0];
    if (!student) throw httpError(404, 'Scan failed.');

    const now = new Date();
    const lastRows = await query(
      `SELECT action, recorded_at FROM attendance
        WHERE user_id = ? AND recorded_at >= ?
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1`,
      [student.id, startOfLocalDayUtc(now.getTime())]
    );
    const last = lastRows[0];

    res.set('Cache-Control', 'no-store');

    // A card held on the reader can fire twice. Repeat the last result
    // instead of flipping Time In to Time Out by accident.
    if (last && now.getTime() - new Date(last.recorded_at).getTime() < DUPLICATE_WINDOW_MS) {
      return res.json({
        attendance: {
          studentId: student.member_id,
          action: last.action,
          recordedAt: new Date(last.recorded_at).toISOString(),
        },
      });
    }

    const action = last && last.action === 'in' ? 'out' : 'in';
    await query(
      `INSERT INTO attendance (user_id, action, recorded_at, kiosk_user_id) VALUES (?, ?, ?, ?)`,
      [student.id, action, now, req.user.id]
    );

    res.json({
      attendance: { studentId: student.member_id, action, recordedAt: now.toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
