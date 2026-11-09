import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { recordAudit } from '../audit.js';
import { publish } from '../events.js';
import { clearResponseCache } from '../responseCache.js';
import { validateHours, saveLibraryHours, loadLibraryHours, libraryStatus, hourText } from '../libraryHours.js';
import { exportDatabase, importDatabase, BackupError } from '../backup.js';
import { config } from '../config.js';

const router = Router();

// The Settings screen is for the super admin only.
router.use(requireAuth, requireRole(ROLES.SUPER_ADMIN));

const backupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: { message: 'Too many backups in a row. Wait a moment and try again.' } }),
});

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hoursBody() {
  const { openHour, closeHour, closedWeekdays } = config.library;
  return { openHour, closeHour, closedWeekdays, status: libraryStatus() };
}

router.get('/library-hours', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(hoursBody());
});

router.patch('/library-hours', async (req, res, next) => {
  try {
    const { errors, values } = validateHours(req.body);
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields and try again.', errors);
    await saveLibraryHours(values);
    clearResponseCache();
    publish('attendance');
    publish('library'); // the kiosk switches between open and closed right away
    const closed = values.closedWeekdays.map((d) => DAY_SHORT[d]).join(', ') || 'none';
    await recordAudit(req, 'settings.library_hours', `Set library hours to ${hourText(values.openHour)} to ${hourText(values.closeHour)}, closed days: ${closed}`);
    res.json(hoursBody());
  } catch (err) {
    next(err);
  }
});

const stamp = () => {
  const d = new Date(Date.now() + Math.trunc(config.attendance.utcOffsetMinutes) * 60000).toISOString();
  return `${d.slice(0, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}`;
};

router.get('/database/export', backupLimiter, async (req, res, next) => {
  try {
    const { sql, counts } = await exportDatabase();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    await recordAudit(req, 'database.export', `Exported a database backup (${total} rows in ${Object.keys(counts).length} tables)`);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="pcds-lrc-backup-${stamp()}.sql"`,
    });
    res.send(sql);
  } catch (err) {
    next(err);
  }
});

// The backup is sent as the raw file. The larger body limit only applies here,
// after the sign-in and role checks above.
router.post(
  '/database/import',
  backupLimiter,
  express.text({ type: () => true, limit: '200mb' }),
  async (req, res, next) => {
    try {
      const text = typeof req.body === 'string' ? req.body.replace(/^﻿/, '') : '';
      if (!text) throw httpError(400, 'Choose a backup file.');
      let counts;
      try {
        ({ counts } = await importDatabase(text));
      } catch (err) {
        if (err instanceof BackupError) throw httpError(400, err.message);
        throw err;
      }
      await loadLibraryHours();
      clearResponseCache();
      publish('attendance');
      publish('messages');
      publish('library');
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      // Written after the import, so the restored audit log keeps this entry.
      await recordAudit(req, 'database.import', `Restored a database backup (${total} rows in ${Object.keys(counts).length} tables)`);
      res.json({ counts });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
