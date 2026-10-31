import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { httpError } from '../middleware/auth.js';
import { requireKioskKey } from '../middleware/kioskKey.js';
import { kioskScanLimiter } from '../middleware/rateLimit.js';
import { publish } from '../events.js';
import { readPinned } from './messages.js';
import { ensureStudentsTable } from '../migrate.js';

// Other routes import this from here.
export { ensureStudentsTable };

const router = Router();

const ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const DUPLICATE_WINDOW_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Everything the kiosk screen needs. The kiosk has no sign-in, so nothing here
// reads or changes staff data: it only records taps and reads messages meant
// for the screen. An optional KIOSK_KEY can lock these routes to one device.
router.use(requireKioskKey);

// Start of the current attendance day (local midnight) expressed in UTC.
function startOfLocalDayUtc(nowMs) {
  const offsetMs = config.attendance.utcOffsetMinutes * 60 * 1000;
  return new Date(Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs);
}

// Finds who a scanned value belongs to.
//  1. An RFID number from students_data: that student. Students have no sign-in
//     account, so their taps are stored against the student record itself.
//  2. Otherwise a member ID of an account (for example the PCDS admin). A student
//     who has a record cannot be scanned by typing their ID, only by their card,
//     so one student never ends up with two separate attendance histories.
async function findSubject(scanned) {
  await ensureStudentsTable();
  const cards = await query('SELECT id, student_id FROM students_data WHERE rfid_number = ? LIMIT 1', [
    scanned.toUpperCase(),
  ]);
  if (cards[0]) return { column: 'student_data_id', id: cards[0].id, label: cards[0].student_id };

  const accounts = await query(
    `SELECT u.id, u.member_id FROM users u
      WHERE u.member_id = ? AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM students_data s WHERE s.student_id = u.member_id)
      LIMIT 1`,
    [scanned]
  );
  return accounts[0] ? { column: 'user_id', id: accounts[0].id, label: accounts[0].member_id } : null;
}

// Records one card tap. The first tap of the day is Time In, the next is
// Time Out, and so on. Every failure returns the same generic message so the
// screen never reveals whether an ID exists or what state an account is in.
router.post('/scan', kioskScanLimiter, async (req, res, next) => {
  try {
    const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
    if (!ID_PATTERN.test(studentId)) throw httpError(400, 'Scan failed.');

    const student = await findSubject(studentId);
    if (!student) throw httpError(404, 'Scan failed.');

    const now = new Date();
    const lastRows = await query(
      `SELECT action, recorded_at FROM attendance
        WHERE ${student.column} = ? AND recorded_at >= ?
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
          studentId: student.label,
          action: last.action,
          recordedAt: new Date(last.recorded_at).toISOString(),
        },
      });
    }

    const action = last && last.action === 'in' ? 'out' : 'in';
    await query(
      `INSERT INTO attendance (${student.column}, action, recorded_at) VALUES (?, ?, ?)`,
      [student.id, action, now]
    );
    publish('attendance');

    // A custom message set for this ID (for example the PCDS admin) is shown
    // by the kiosk before the result: the Time In message on Time In, the
    // Time Out message on Time Out. Repeat taps above do not include it.
    const rules = await query(
      'SELECT message, message_out FROM message_rules WHERE student_id = ? AND enabled = 1 LIMIT 1',
      [String(student.label).toUpperCase()]
    );

    res.json({
      attendance: { studentId: student.label, action, recordedAt: now.toISOString() },
      message: (rules[0] && (action === 'in' ? rules[0].message : rules[0].message_out)) || null,
    });
  } catch (err) {
    next(err);
  }
});

// The kiosk screen polls this for messages sent from the dashboard. The first call (no "after") only learns the
// latest message number, so a freshly opened kiosk never replays old messages.
router.get('/messages', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    if (req.query.after === undefined) {
      const rows = await query('SELECT COALESCE(MAX(id), 0) AS latest FROM kiosk_broadcasts');
      return res.json({ messages: [], latestId: Number(rows[0].latest), pinned: await readPinned() });
    }

    if (typeof req.query.after !== 'string' || !/^\d{1,18}$/.test(req.query.after)) {
      throw httpError(400, 'Invalid request.');
    }
    const after = Number(req.query.after);
    const rows = await query(
      'SELECT id, message FROM kiosk_broadcasts WHERE id > ? ORDER BY id LIMIT 10',
      [after]
    );
    res.json({
      messages: rows.map((r) => ({ id: r.id, text: r.message })),
      latestId: rows.length ? rows[rows.length - 1].id : after,
      pinned: await readPinned(),
    });
  } catch (err) {
    next(err);
  }
});

// The message kept on screen until staff switch it off.
router.get('/pinned', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ pinned: await readPinned() });
  } catch (err) {
    next(err);
  }
});

export default router;
