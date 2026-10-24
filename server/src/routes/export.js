import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireRole, httpError } from '../middleware/auth.js';
import { VISITS_SQL } from '../visits.js';

const router = Router();

// Exports hold every student's name and ID, so only administrators can download them.
router.use(requireAuth, requireRole(ROLES.ADMIN));

const MAX_PDF_ROWS = 10000;
const MAX_RANGE_MS = 367 * 24 * 60 * 60 * 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function parseInstant(value, label) {
  const d = typeof value === 'string' && ISO_RE.test(value) ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw httpError(400, `${label} is not a valid date.`);
  return d;
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

// Times are stored in UTC; the file shows them in the time zone of the person exporting.
function makeFormatters(tz) {
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (d) => Object.fromEntries(stamp.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    dateTime(value) {
      if (!value) return '';
      const p = parts(new Date(value));
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    },
    ymd(value) {
      const p = parts(new Date(value));
      return { year: p.year, month: p.month };
    },
  };
}

const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function durationMinutes(r) {
  if (!r.time_out) return null;
  return Math.max(Math.floor((new Date(r.time_out) - new Date(r.time_in)) / 60000), 0);
}

function formatDuration(minutes) {
  if (minutes === null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Quotes cells for CSV, and defuses cells that a spreadsheet would run as a formula.
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, { rows, tz, fmt, filename }) {
  const header = [
    'Type',
    'Student ID',
    'Name',
    'Course',
    'Gender',
    `Time In (${tz})`,
    `Time Out (${tz})`,
    'Status',
    'Duration (minutes)',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const minutes = durationMinutes(r);
    lines.push(
      [
        r.attendance_type === 'rfid' ? 'RFID' : 'Manual',
        r.student_id,
        r.student_name,
        r.course || '',
        titleCase(r.gender),
        fmt.dateTime(r.time_in),
        fmt.dateTime(r.time_out),
        r.time_out ? 'Timed out' : 'Timed in',
        minutes === null ? '' : minutes,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}.csv"`,
    'Cache-Control': 'no-store',
  });
  // The byte order mark makes Excel read the file as UTF-8, so names keep their accents.
  res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
}

// The built-in PDF fonts only cover Western European letters, so anything else shows as "?".
const pdfSafe = (s) => String(s ?? '').replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '?');

function fit(doc, text, width) {
  if (doc.widthOfString(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > width) t = t.slice(0, -1);
  return `${t}...`;
}

const COLUMNS = [
  { key: 'type', label: 'Type', width: 42 },
  { key: 'studentId', label: 'Student ID', width: 80 },
  { key: 'name', label: 'Name', width: 165 },
  { key: 'course', label: 'Course', width: 175 },
  { key: 'gender', label: 'Gender', width: 42 },
  { key: 'timeIn', label: 'Time In', width: 98 },
  { key: 'timeOut', label: 'Time Out', width: 98 },
  { key: 'duration', label: 'Duration', width: 60 },
];

function sendPdf(res, { rows, tz, fmt, label, filename }) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
    bufferPages: true,
    info: { Title: `Attendance report - ${label}`, Author: 'PCDS RFID Kiosk' },
  });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}.pdf"`,
    'Cache-Control': 'no-store',
  });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const bottomLimit = doc.page.height - 52;
  const rowH = 16;
  const tableW = COLUMNS.reduce((sum, c) => sum + c.width, 0);

  const rfid = rows.filter((r) => r.attendance_type === 'rfid').length;
  const open = rows.filter((r) => !r.time_out).length;

  doc.font('Helvetica-Bold').fontSize(17).fillColor('#185688').text('PCDS RFID Kiosk - Attendance Report', left, 36);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#14283c').text(pdfSafe(label), left, doc.y + 2);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#566c84')
    .text(`Generated ${fmt.dateTime(new Date())} (${pdfSafe(tz)})`, left, doc.y + 2)
    .text(
      `${rows.length} visits: ${rfid} RFID, ${rows.length - rfid} manual. ${open} still timed in at the end of the report.`,
      left,
      doc.y + 1
    );

  let y = doc.y + 14;

  function drawHeader() {
    doc.rect(left, y, tableW, rowH + 2).fill('#e3f0fa');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#185688');
    let x = left;
    for (const c of COLUMNS) {
      doc.text(c.label, x + 4, y + 5, { width: c.width - 8, lineBreak: false });
      x += c.width;
    }
    y += rowH + 2;
  }

  drawHeader();

  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#566c84').text('No attendance was recorded in this period.', left + 4, y + 10);
  }

  rows.forEach((r, i) => {
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    if (i % 2 === 1) doc.rect(left, y, tableW, rowH).fill('#f2f8fd');
    const cells = {
      type: r.attendance_type === 'rfid' ? 'RFID' : 'Manual',
      studentId: r.student_id,
      name: r.student_name,
      course: r.course || '-',
      gender: titleCase(r.gender) || '-',
      timeIn: fmt.dateTime(r.time_in),
      timeOut: r.time_out ? fmt.dateTime(r.time_out) : 'Still in',
      duration: r.time_out ? formatDuration(durationMinutes(r)) : '-',
    };
    doc.font('Helvetica').fontSize(8).fillColor('#14283c');
    let x = left;
    for (const c of COLUMNS) {
      doc.text(fit(doc, pdfSafe(cells[c.key]), c.width - 8), x + 4, y + 4, { width: c.width - 8, lineBreak: false });
      x += c.width;
    }
    y += rowH;
  });

  // Page numbers go on last, once the page count is known. The bottom margin is
  // lifted while writing them so they do not trigger a new page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#566c84')
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 30, {
        width: tableW,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}

// GET /api/export/attendance?format=csv|pdf&period=month|year&from=<ISO>&to=<ISO>&tz=<IANA zone>
// from and to are the start and end of the chosen month or year in the person's
// own time zone, sent as UTC instants. Every visit that began in that window is included.
router.get('/attendance', async (req, res, next) => {
  try {
    const { format, period } = req.query;
    if (!['csv', 'pdf'].includes(format)) throw httpError(400, 'Choose CSV or PDF.');
    if (!['month', 'year'].includes(period)) throw httpError(400, 'Choose a month or a year.');

    const from = parseInstant(req.query.from, 'Start date');
    const to = parseInstant(req.query.to, 'End date');
    if (to <= from) throw httpError(400, 'The end date must be after the start date.');
    if (to - from > MAX_RANGE_MS) throw httpError(400, 'Choose a single month or a single year.');

    const tz = validTimeZone(req.query.tz);
    const fmt = makeFormatters(tz);

    const rows = await query(
      `SELECT * FROM (${VISITS_SQL}) v
        WHERE v.time_in >= ? AND v.time_in < ?
        ORDER BY v.time_in ASC, v.source_id ASC`,
      [sqlDate(from), sqlDate(to)]
    );

    if (format === 'pdf' && rows.length > MAX_PDF_ROWS) {
      throw httpError(
        413,
        `This period has ${rows.length.toLocaleString('en-US')} visits, which is too many for one PDF. Download the CSV, or choose a single month.`
      );
    }

    const { year, month } = fmt.ymd(from);
    const filename = period === 'month' ? `attendance-${year}-${month}` : `attendance-${year}`;
    const label =
      period === 'month'
        ? new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' }).format(from)
        : `Year ${year}`;

    if (format === 'csv') sendCsv(res, { rows, tz, fmt, filename });
    else sendPdf(res, { rows, tz, fmt, label, filename });
  } catch (err) {
    next(err);
  }
});

export default router;
