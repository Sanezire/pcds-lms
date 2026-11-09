import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { httpError } from '../middleware/auth.js';
import { requireKioskKey } from '../middleware/kioskKey.js';
import { kioskScanLimiter } from '../middleware/rateLimit.js';
import { publish } from '../events.js';
import { readPinned } from './messages.js';
import { ensureStudentsTable } from '../migrate.js';
import { lockStudent, closeStaleVisits } from '../attendance.js';
import { libraryStatus } from '../libraryHours.js';

// Other routes import this from here.
export { ensureStudentsTable };

const router = Router();

const ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const DUPLICATE_WINDOW_MS = 5000;

// Everything the kiosk screen needs. The kiosk has no sign-in, so nothing here
// reads or changes staff data: it only records taps and reads messages meant
// for the screen. An optional KIOSK_KEY can lock these routes to one device.
router.use(requireKioskKey);

// RFID attendance belongs to a registered student record.
async function findSubject(scanned) {
  await ensureStudentsTable();
  const cards = await query("SELECT id, student_id FROM students_data WHERE rfid_number = ? AND status='active' LIMIT 1", [
    scanned.toUpperCase(),
  ]);
  if (cards[0]) return { column: 'student_data_id', id: cards[0].id, label: cards[0].student_id };

  return null;
}

// Records one card tap. A tap starts a visit (Time In); the next tap closes it
// (Time Out). A visit left open on an earlier day is closed at that day's closing
// time first, so the first tap of a new day is always a Time In. Every failure
// returns the same generic message so the screen never reveals whether an ID
// exists or what state an account is in.
router.post('/scan', kioskScanLimiter, async (req, res, next) => {
  try {
    // Taps are only accepted while the library is open (Settings > Library hours).
    // A visit still open at closing time is closed automatically the next day.
    const status = libraryStatus();
    if (!status.open) throw httpError(403, 'The library is closed.', { libraryClosed: status.hours });

    const scanned = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
    if (!ID_PATTERN.test(scanned)) throw httpError(400, 'Scan failed.');

    const student = await findSubject(scanned);
    if (!student) throw httpError(404, 'Scan failed.');

    const result = await withTransaction(async (tx) => {
      // Taps for the same student are handled one at a time.
      await lockStudent(tx, student.id);
      const now = new Date();
      await closeStaleVisits(tx, student.id, now.getTime());

      const [last] = await tx.query(
        `SELECT id, time_in, time_out FROM attendance
          WHERE student_data_id = ?
          ORDER BY time_in DESC, id DESC
          LIMIT 1`,
        [student.id]
      );

      // A card held on the reader can fire twice. Repeat the last result
      // instead of flipping Time In to Time Out by accident.
      if (last) {
        const lastAt = new Date(last.time_out || last.time_in);
        if (now.getTime() - lastAt.getTime() < DUPLICATE_WINDOW_MS) {
          return { repeat: true, action: last.time_out ? 'out' : 'in', at: lastAt };
        }
      }

      if (last && !last.time_out) {
        await tx.query('UPDATE attendance SET time_out = ? WHERE id = ?', [now, last.id]);
        return { action: 'out', at: now };
      }
      await tx.query("INSERT INTO attendance (student_data_id, type, time_in) VALUES (?, 'rfid', ?)", [student.id, now]);
      return { action: 'in', at: now };
    });

    res.set('Cache-Control', 'no-store');
    const attendance = { studentId: student.label, action: result.action, recordedAt: result.at.toISOString() };
    if (result.repeat) return res.json({ attendance });
    publish('attendance');

    // A custom message set for this ID is shown by the kiosk before the result:
    // the Time In message on Time In, the Time Out message on Time Out. Repeat
    // taps above do not include it.
    const rules = await query(
      'SELECT message, message_out FROM message_rules WHERE student_id = ? AND enabled = 1 LIMIT 1',
      [String(student.label).toUpperCase()]
    );

    res.json({
      attendance,
      message: (rules[0] && (result.action === 'in' ? rules[0].message : rules[0].message_out)) || null,
    });
  } catch (err) {
    next(err);
  }
});

// Whether the library is open now, so the kiosk can say so before anyone taps.
router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(libraryStatus());
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
