import { Router } from 'express';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { publish } from '../events.js';
import { validateMessageText, validateOptionalMessage, validateRuleId } from '../validation.js';

const router = Router();

// Same access as the rest of the staff tools: signed-in admins and librarians.
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

const toRule = (r) => ({
  id: r.id,
  studentId: r.student_id,
  message: r.message,
  messageOut: r.message_out,
  enabled: Boolean(r.enabled),
});

const RULE_COLUMNS = 'id, student_id, message, message_out, enabled';
const NEED_ONE = 'Enter a Time In message, a Time Out message, or both.';

const parseId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid message.');
  return id;
};

// ---- ID messages: shown on the kiosk when a specific ID is scanned ----

router.get('/rules', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT ${RULE_COLUMNS} FROM message_rules ORDER BY student_id`
    );
    res.json({ rules: rows.map(toRule) });
  } catch (err) {
    next(err);
  }
});

router.post('/rules', async (req, res, next) => {
  try {
    const id = validateRuleId(req.body?.studentId);
    const messageIn = validateOptionalMessage(req.body?.message);
    const messageOut = validateOptionalMessage(req.body?.messageOut);
    const fields = {};
    if (id.error) fields.studentId = id.error;
    if (messageIn.error) fields.message = messageIn.error;
    if (messageOut.error) fields.messageOut = messageOut.error;
    if (!messageIn.error && !messageOut.error && !messageIn.message && !messageOut.message) {
      fields.message = NEED_ONE;
    }
    if (Object.keys(fields).length) {
      throw httpError(400, 'Check the highlighted fields and try again.', fields);
    }

    try {
      const result = await query(
        'INSERT INTO message_rules (student_id, message, message_out, enabled, created_by) VALUES (?, ?, ?, 1, ?)',
        [id.studentId, messageIn.message, messageOut.message, req.user.id]
      );
      const rows = await query(`SELECT ${RULE_COLUMNS} FROM message_rules WHERE id = ?`, [result.insertId]);
      publish('messages');
      res.status(201).json({ rule: toRule(rows[0]) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw httpError(409, 'This ID already has a message. Edit it instead.', {
          studentId: 'This ID already has a message.',
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Edit the messages and/or switch the ID's messages on or off. The ID cannot change;
// delete the message and add a new one instead.
router.patch('/rules/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = (await query(`SELECT ${RULE_COLUMNS} FROM message_rules WHERE id = ?`, [id]))[0];
    if (!current) throw httpError(404, 'Message not found.');

    const sets = [];
    const params = [];
    const merged = { message: current.message, messageOut: current.message_out };
    const fields = {};

    for (const [key, column] of [['message', 'message'], ['messageOut', 'message_out']]) {
      if (req.body?.[key] === undefined) continue;
      const checked = validateOptionalMessage(req.body[key]);
      if (checked.error) fields[key] = checked.error;
      merged[key] = checked.message;
      sets.push(`${column} = ?`);
      params.push(checked.message);
    }
    if (!Object.keys(fields).length && sets.length && !merged.message && !merged.messageOut) {
      fields.message = NEED_ONE;
    }
    if (Object.keys(fields).length) throw httpError(400, 'Check the highlighted fields and try again.', fields);

    if (req.body?.enabled !== undefined) {
      if (typeof req.body.enabled !== 'boolean') throw httpError(400, 'Invalid value.');
      sets.push('enabled = ?');
      params.push(req.body.enabled ? 1 : 0);
    }
    if (!sets.length) throw httpError(400, 'Nothing to update.');

    await query(`UPDATE message_rules SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    const rows = await query(`SELECT ${RULE_COLUMNS} FROM message_rules WHERE id = ?`, [id]);
    publish('messages');
    res.json({ rule: toRule(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM message_rules WHERE id = ?', [parseId(req.params.id)]);
    if (!result.affectedRows) throw httpError(404, 'Message not found.');
    publish('messages');
    res.json({ message: 'Deleted.' });
  } catch (err) {
    next(err);
  }
});

// ---- Direct messages: sent to the kiosk right away ----

router.post('/broadcast', async (req, res, next) => {
  try {
    const text = validateMessageText(req.body?.message);
    if (text.error) throw httpError(400, text.error, { message: text.error });

    await query('INSERT INTO kiosk_broadcasts (message, created_by) VALUES (?, ?)', [text.message, req.user.id]);
    // Old rows are only history; keep the table small.
    await query('DELETE FROM kiosk_broadcasts WHERE created_at < (NOW() - INTERVAL 7 DAY)');
    publish('messages');

    res.status(201).json({ message: 'Sent to the kiosk.' });
  } catch (err) {
    next(err);
  }
});

// Every direct message sent to the kiosk, newest first, so staff can review or
// remove them. Messages for specific IDs are separate and not listed here.
// The age is measured by the database itself so it is right in any time zone.
router.get('/broadcasts', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, message, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
         FROM kiosk_broadcasts
        ORDER BY id DESC
        LIMIT 200`
    );
    const now = Date.now();
    res.set('Cache-Control', 'no-store');
    res.json({
      broadcasts: rows.map((r) => ({
        id: r.id,
        text: r.message,
        sentAt: new Date(now - Math.max(Number(r.age_seconds), 0) * 1000).toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/broadcasts', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM kiosk_broadcasts');
    publish('messages');
    res.json({ message: 'Deleted.', deleted: result.affectedRows });
  } catch (err) {
    next(err);
  }
});

router.delete('/broadcasts/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM kiosk_broadcasts WHERE id = ?', [parseId(req.params.id)]);
    if (!result.affectedRows) throw httpError(404, 'Message not found.');
    publish('messages');
    res.json({ message: 'Deleted.' });
  } catch (err) {
    next(err);
  }
});

// The kiosk screen polls this. The first call (no "after") only learns the
// latest message number, so a freshly opened kiosk never replays old messages.
router.get('/kiosk', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    if (req.query.after === undefined) {
      const rows = await query('SELECT COALESCE(MAX(id), 0) AS latest FROM kiosk_broadcasts');
      return res.json({ messages: [], latestId: Number(rows[0].latest) });
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
    });
  } catch (err) {
    next(err);
  }
});

export default router;
