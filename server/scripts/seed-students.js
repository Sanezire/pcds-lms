import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// Mock data for testing:
//   1. Adds the students in a CSV file (default: scripts/students_data.csv) to
//      students_data. Students already there (same student ID or RFID) are left alone.
//   2. Fills the attendance table with five years of mock visits (kiosk and manual,
//      one row per visit) for those students, up to the current time.
//
//   npm run seed:students                      uses scripts/students_data.csv
//   npm run seed:students -- other.csv         uses another CSV
//   npm run seed:students -- --replace         first deletes the attendance of those students
//
// The CSV needs the columns rfid_number, student_id, full_name, course, gender, year_level
// (others are ignored). The same file always produces the same visits.

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const replace = args.includes('--replace');
const csvPath = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(here, 'students_data.csv'));

const OFFSET = Number.parseInt(process.env.ATTENDANCE_UTC_OFFSET_MINUTES ?? '480', 10) || 480;
const hourEnv = (v, d) => (Number.isInteger(Number.parseInt(v ?? '', 10)) ? Number.parseInt(v, 10) : d);
let OPEN = hourEnv(process.env.LIBRARY_OPEN_HOUR, 8);
let CLOSE = hourEnv(process.env.LIBRARY_CLOSE_HOUR, 17);
if (!(OPEN >= 0 && CLOSE <= 24 && CLOSE > OPEN)) [OPEN, CLOSE] = [8, 17];
const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
const YEARS = 5;

// ---- CSV ------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

function readStudents(file) {
  const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const idx = Object.fromEntries(['rfid_number', 'student_id', 'full_name', 'course', 'gender', 'year_level'].map((n) => [n, col(n)]));
  for (const [name, i] of Object.entries(idx)) {
    if (i < 0 && name !== 'rfid_number') throw new Error(`The CSV has no ${name} column.`);
  }
  const students = [];
  lines.forEach((cells, n) => {
    const get = (name) => (idx[name] < 0 ? '' : (cells[idx[name]] ?? '').trim());
    const s = {
      rfid: get('rfid_number').toUpperCase() || null,
      studentId: get('student_id'),
      fullName: get('full_name').replace(/\s+/g, ' '),
      course: get('course').replace(/\s+/g, ' '),
      gender: get('gender').toLowerCase(),
      yearLevel: Number(get('year_level')),
    };
    const ok = s.studentId && s.fullName.length >= 2 && s.course.length >= 2 &&
      ['male', 'female', 'other'].includes(s.gender) && [1, 2, 3, 4].includes(s.yearLevel);
    if (ok) students.push(s);
    else console.warn(`Skipped line ${n + 2}: missing or invalid values.`);
  });
  return students;
}

// ---- Visits ---------------------------------------------------------------
let seed = 0x5eed2026;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
}
const dateKey = (d) => d.toISOString().slice(0, 10);

// Busier mid-morning and early afternoon, quiet at opening and closing.
function arrivalMinute() {
  const span = (CLOSE - OPEN) * 60;
  const peaks = [0.3, 0.62];
  const center = peaks[random() < 0.55 ? 0 : 1] * span;
  const spread = (random() + random() + random() - 1.5) * span * 0.35;
  return Math.max(0, Math.min(span - 15, Math.round(center + spread)));
}

function makeVisits(students) {
  const nowLocal = Date.now() + OFFSET * MS_MIN;
  const today = new Date(`${dateKey(new Date(nowLocal))}T00:00:00Z`);
  const start = new Date(Date.UTC(today.getUTCFullYear() - YEARS, today.getUTCMonth(), today.getUTCDate()));
  const visits = [];

  for (let t = start.getTime(); t <= today.getTime(); t += MS_DAY) {
    const day = new Date(t);
    const dow = day.getUTCDay();
    // School-year rhythm: busy around exams, quiet during the June-August break and December.
    const seasonal = [0.85, 0.8, 1.0, 1.1, 1.2, 0.55, 0.2, 0.3, 1.1, 1.15, 0.9, 0.4][day.getUTCMonth()];
    const weekday = dow === 0 ? 0.02 : dow === 6 ? 0.3 : dow === 5 ? 0.85 : 1;
    const growth = 1 + ((t - start.getTime()) / (today.getTime() - start.getTime())) * 0.6;
    const count = Math.max(0, Math.round(55 * seasonal * weekday * growth * (0.8 + random() * 0.4)));

    // Each student visits at most once a day (sometimes twice, one visit after the other).
    const chosen = new Set();
    while (chosen.size < Math.min(count, students.length)) chosen.add(Math.floor(random() * students.length));

    for (const i of chosen) {
      const student = students[i];
      const type = student.rfid && random() > 0.2 ? 'rfid' : 'manual';
      let inMin = OPEN * 60 + arrivalMinute();
      const trips = random() < 0.1 ? 2 : 1;
      for (let k = 0; k < trips; k += 1) {
        const stay = 15 + Math.floor(random() * random() * 180);
        const outMin = Math.min(inMin + stay, CLOSE * 60);
        const timeIn = t + inMin * MS_MIN;
        if (timeIn > nowLocal) break;
        // Visits still going on right now stay open (no Time Out yet).
        const timeOut = t + outMin * MS_MIN > nowLocal ? null : t + outMin * MS_MIN;
        visits.push({ student, type, timeIn: new Date(timeIn - OFFSET * MS_MIN), timeOut: timeOut && new Date(timeOut - OFFSET * MS_MIN) });
        if (!timeOut) break;
        inMin = outMin + 30 + Math.floor(random() * 90);
        if (inMin >= CLOSE * 60 - 15) break;
      }
    }
  }
  return visits;
}

// ---- Database -------------------------------------------------------------
const students = readStudents(csvPath);
if (!students.length) throw new Error('No valid students in the CSV.');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'pcds_lms',
  timezone: 'Z', // times are stored in UTC, like the server does
});

async function inChunks(list, size, run) {
  for (let i = 0; i < list.length; i += size) await run(list.slice(i, i + size));
}

try {
  await connection.beginTransaction();

  let added = 0;
  await inChunks(students, 500, async (part) => {
    const [r] = await connection.query(
      `INSERT IGNORE INTO students_data (rfid_number, student_id, full_name, course, gender, year_level) VALUES ${part.map(() => '(?,?,?,?,?,?)').join(',')}`,
      part.flatMap((s) => [s.rfid, s.studentId, s.fullName, s.course, s.gender, s.yearLevel])
    );
    added += r.affectedRows;
  });

  // Use the records as they are in the database (an existing record wins over the CSV).
  const records = [];
  await inChunks(students.map((s) => s.studentId), 500, async (ids) => {
    const [rows] = await connection.query(
      `SELECT id, rfid_number, student_id, full_name, course, gender, year_level FROM students_data WHERE student_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    records.push(...rows.map((r) => ({ dataId: r.id, rfid: r.rfid_number, studentId: r.student_id, fullName: r.full_name, course: r.course, gender: r.gender, yearLevel: r.year_level })));
  });
  records.sort((a, b) => a.studentId.localeCompare(b.studentId)); // same order every run

  const dataIds = records.map((r) => r.dataId);
  let existing = 0;
  await inChunks(records, 500, async (part) => {
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS n FROM attendance WHERE student_data_id IN (${part.map(() => '?').join(',')})`,
      part.map((r) => r.dataId)
    );
    existing += Number(row.n);
  });

  if (existing && !replace) {
    await connection.rollback();
    console.log(`These students already have ${existing} attendance rows. Run again with --replace to delete them and generate new ones.`);
  } else {
    if (existing) {
      await inChunks(dataIds, 500, (part) => connection.query(`DELETE FROM attendance WHERE student_data_id IN (${part.map(() => '?').join(',')})`, part));
    }

    const visits = makeVisits(records);
    // One row per visit, linked to the student record.
    const rows = visits
      .map((v) => [v.student.dataId, v.type, v.timeIn, v.timeOut])
      .sort((a, b) => a[2] - b[2]);
    await inChunks(rows, 1000, (part) =>
      connection.query(`INSERT INTO attendance (student_data_id, type, time_in, time_out) VALUES ${part.map(() => '(?,?,?,?)').join(',')}`, part.flat())
    );
    await connection.commit();

    const rfidVisits = visits.filter((v) => v.type === 'rfid').length;
    console.log(
      `Students: ${added} added, ${students.length - added} already there. ` +
        `Attendance: ${visits.length} visits over ${YEARS} years (${rfidVisits} kiosk, ${visits.length - rfidVisits} manual)` +
        (existing ? `, replacing ${existing} old rows.` : '.')
    );
  }
} catch (err) {
  await connection.rollback().catch(() => {});
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
