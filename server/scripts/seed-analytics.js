import 'dotenv/config';
import mysql from 'mysql2/promise';

// Deterministic five-year analytics fixture. It owns only rows recorded in the
// analytics_mock_* tables, so --replace can safely remove and rebuild its data.
const SEED = 'analytics-five-years-v1';
const OFFSET = Number.parseInt(process.env.ATTENDANCE_UTC_OFFSET_MINUTES ?? '480', 10) || 480;
const COURSES = [
  'BS Nursing',
  'BS Hospitality Management',
  'BS Radiologic Technology',
  'BS Criminology',
  'BS Information Technology',
  'Diploma in Hotel and Restaurant Technology',
];
const GENDERS = ['male', 'female', 'other'];
const FIRST_NAMES = ['Alex', 'Andrea', 'Angel', 'Bea', 'Carlo', 'Dani', 'Ethan', 'Faith', 'Gabriel', 'Hannah', 'Ivan', 'Jasmine', 'Kyla', 'Liam', 'Maria', 'Noah', 'Olivia', 'Paolo', 'Rafael', 'Sofia'];
const LAST_NAMES = ['Aquino', 'Bautista', 'Cruz', 'Dela Rosa', 'Garcia', 'Lim', 'Mendoza', 'Navarro', 'Reyes', 'Santos', 'Tan', 'Villanueva'];
const TOTAL_STUDENTS = 120;
const MS_DAY = 86_400_000;
const MS_MINUTE = 60_000;

let state = 0x5eed1234;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x1_0000_0000;
}
const pick = (items) => items[Math.floor(random() * items.length)];
const dateKey = (date) => date.toISOString().slice(0, 10);
const localToday = dateKey(new Date(Date.now() + OFFSET * MS_MINUTE));
const end = new Date(`${localToday}T00:00:00Z`);
const start = new Date(Date.UTC(end.getUTCFullYear() - 5, end.getUTCMonth(), end.getUTCDate()));
const startDay = dateKey(start);

function makeStudents() {
  return Array.from({ length: TOTAL_STUDENTS }, (_, i) => ({
    studentId: `2099-${String(9000 + i).slice(-4)}-${i % 10}`,
    rfid: (0xf0000000 + i).toString(16).toUpperCase(),
    fullName: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]} ${String.fromCharCode(65 + (i % 26))}`,
    course: COURSES[i % COURSES.length],
    gender: i % 20 === 0 ? 'other' : i % 2 === 0 ? 'female' : 'male',
    yearLevel: (i % 4) + 1,
  }));
}

function makeAttendance(students) {
  const rfidVisits = [];
  const manualVisits = [];
  for (let dayTime = start.getTime(); dayTime <= end.getTime(); dayTime += MS_DAY) {
    const day = new Date(dayTime);
    const dow = day.getUTCDay();
    const month = day.getUTCMonth();
    const yearProgress = (day.getUTCFullYear() - start.getUTCFullYear()) / 5;
    const seasonal = [0.82, 0.76, 0.95, 1.08, 1.18, 0.62, 0.24, 0.30, 1.12, 1.16, 0.86, 0.42][month];
    const weekend = dow === 0 ? 0.035 : dow === 6 ? 0.28 : 1;
    const expected = (dow === 0 ? 1 : 13 + yearProgress * 9) * seasonal * weekend;
    const count = Math.max(0, Math.floor(expected + random() * 5 - 1));

    for (let i = 0; i < count; i += 1) {
      const student = pick(students);
      const rareClosedDay = random() < 0.018;
      const localHour = rareClosedDay ? (dow === 0 ? 10 + Math.floor(random() * 6) : 7 + Math.floor(random() * 12)) : 8 + Math.floor(random() * 9);
      const localMinute = Math.floor(random() * 60);
      const localStartMs = dayTime + (localHour * 60 + localMinute) * MS_MINUTE;
      if (dateKey(day) === localToday && localStartMs > Date.now() + OFFSET * MS_MINUTE) continue;

      const timeIn = new Date(localStartMs - OFFSET * MS_MINUTE);
      const duration = 12 + Math.floor(random() * 188);
      const openVisit = dateKey(day) === localToday && random() < 0.035;
      const timeOut = openVisit ? null : new Date(timeIn.getTime() + duration * MS_MINUTE);
      const visit = { studentId: student.studentId, fullName: student.fullName, course: student.course, gender: student.gender, yearLevel: student.yearLevel, timeIn, timeOut };
      const typeManual = random() < 0.23;
      (typeManual ? manualVisits : rfidVisits).push(visit);

      // Repeat visits by a student in one day test per-student/day de-duplication.
      if (random() < 0.11) {
        const secondIn = new Date(localStartMs + (240 + Math.floor(random() * 180)) * MS_MINUTE - OFFSET * MS_MINUTE);
        const secondOut = new Date(secondIn.getTime() + (15 + Math.floor(random() * 120)) * MS_MINUTE);
        (typeManual ? manualVisits : rfidVisits).push({ ...visit, timeIn: secondIn, timeOut: secondOut });
      }
    }
  }
  return { rfidVisits, manualVisits };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Mock data validation failed: ${message}`);
}

function validateFixture(students, { rfidVisits, manualVisits }) {
  const studentIds = new Set();
  const rfids = new Set();
  const studentsById = new Map();

  for (const student of students) {
    assert(typeof student.studentId === 'string' && /^\d{4}-\d{4}-\d$/.test(student.studentId), `invalid student ID ${student.studentId}`);
    assert(typeof student.rfid === 'string' && /^[0-9A-F]+$/.test(student.rfid) && student.rfid.length <= 32, `invalid RFID for ${student.studentId}`);
    assert(typeof student.fullName === 'string' && student.fullName.length > 0 && student.fullName.length <= 100 && /^[A-Za-z .'-]+$/.test(student.fullName), `invalid name for ${student.studentId}`);
    assert(COURSES.includes(student.course) && student.course.length <= 100, `unapproved course for ${student.studentId}`);
    assert(GENDERS.includes(student.gender), `invalid gender for ${student.studentId}`);
    assert(Number.isInteger(student.yearLevel) && student.yearLevel >= 1 && student.yearLevel <= 4, `year level outside 1-4 for ${student.studentId}`);
    assert(!studentIds.has(student.studentId), `duplicate student ID ${student.studentId}`);
    assert(!rfids.has(student.rfid), `duplicate RFID ${student.rfid}`);
    studentIds.add(student.studentId);
    rfids.add(student.rfid);
    studentsById.set(student.studentId, student);
  }

  const validateVisit = (visit, type) => {
    const student = studentsById.get(visit.studentId);
    assert(student, `${type} attendance references nonexistent generated student ${visit.studentId}`);
    assert(visit.fullName === student.fullName && visit.course === student.course && visit.gender === student.gender && visit.yearLevel === student.yearLevel, `${type} attendance details disagree with student ${visit.studentId}`);
    assert(visit.timeIn instanceof Date && Number.isFinite(visit.timeIn.getTime()), `invalid ${type} time-in timestamp`);
    assert(visit.timeOut === null || (visit.timeOut instanceof Date && Number.isFinite(visit.timeOut.getTime()) && visit.timeOut > visit.timeIn), `invalid ${type} time-out timestamp`);
  };
  for (const visit of rfidVisits) validateVisit(visit, 'RFID');
  for (const visit of manualVisits) validateVisit(visit, 'manual');
}

const students = makeStudents();
const attendance = makeAttendance(students);
validateFixture(students, attendance); // Validate every value before the first insert.

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'pcds_lms',
  timezone: 'Z', // times are stored in UTC, like the server does
});

async function removeOwnedFixture() {
  const [ownedRows] = await connection.execute('SELECT source_table, source_id FROM analytics_mock_rows WHERE seed_key = ?', [SEED]);
  for (const [table, ids] of [
    ['attendance', ownedRows.filter((row) => row.source_table === 'attendance').map((row) => row.source_id)],
    ['attendance', ownedRows.filter((row) => row.source_table === 'attendance').map((row) => row.source_id)],
  ]) {
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      if (slice.length) await connection.query(`DELETE FROM ${table} WHERE id IN (${slice.map(() => '?').join(',')})`, slice);
    }
  }
  await connection.execute('DELETE FROM analytics_mock_rows WHERE seed_key = ?', [SEED]);
  const [ownedStudents] = await connection.execute('SELECT student_data_id FROM analytics_mock_students WHERE seed_key = ?', [SEED]);
  const ids = ownedStudents.map((student) => student.student_data_id);
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    if (slice.length) await connection.query(`DELETE FROM students_data WHERE id IN (${slice.map(() => '?').join(',')})`, slice);
  }
  await connection.execute('DELETE FROM analytics_mock_students WHERE seed_key = ?', [SEED]);
}

async function insertTracked(table, columns, values) {
  const ids = [];
  const size = 400;
  for (let i = 0; i < values.length; i += size) {
    const batch = values.slice(i, i + size);
    const tuple = `(${columns.map(() => '?').join(',')})`;
    const [result] = await connection.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`, batch.flat());
    for (let j = 0; j < result.affectedRows; j += 1) ids.push(Number(result.insertId) + j);
  }
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500).map((id) => [SEED, table, id]);
    await connection.query(`INSERT INTO analytics_mock_rows (seed_key, source_table, source_id) VALUES ${batch.map(() => '(?,?,?)').join(',')}`, batch.flat());
  }
  return ids.length;
}

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS analytics_mock_batches (
    seed_key VARCHAR(80) NOT NULL PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE IF NOT EXISTS analytics_mock_students (
    seed_key VARCHAR(80) NOT NULL,
    student_data_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (seed_key, student_data_id),
    CONSTRAINT fk_analytics_mock_students FOREIGN KEY (student_data_id) REFERENCES students_data(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE IF NOT EXISTS analytics_mock_rows (
    seed_key VARCHAR(80) NOT NULL,
    source_table ENUM('attendance') NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (seed_key, source_table, source_id)
  ) ENGINE=InnoDB`);

  const replace = process.argv.includes('--replace');
  await connection.beginTransaction();
  const [batches] = await connection.execute('SELECT seed_key FROM analytics_mock_batches WHERE seed_key = ? FOR UPDATE', [SEED]);
  if (batches.length && !replace) {
    await connection.rollback();
    console.log(`Analytics mock data already exists (${SEED}). Use --replace to rebuild only its tracked rows.`);
  } else {
    if (batches.length) await removeOwnedFixture();

    // Preflight unique keys inside the transaction (after fixture cleanup) so an
    // unrelated record cannot be mistaken for one of these deterministic students.
    const ids = students.map((student) => student.studentId);
    const cardIds = students.map((student) => student.rfid);
    const [conflicts] = await connection.query(
      `SELECT student_id, rfid_number FROM students_data WHERE student_id IN (${ids.map(() => '?').join(',')}) OR rfid_number IN (${cardIds.map(() => '?').join(',')}) LIMIT 1`,
      [...ids, ...cardIds]
    );
    assert(conflicts.length === 0, `generated student ID or RFID conflicts with existing student ${conflicts[0]?.student_id || conflicts[0]?.rfid_number}`);

    await connection.execute('INSERT INTO analytics_mock_batches (seed_key) VALUES (?) ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP', [SEED]);
    const studentDataIds = new Map();
    for (const student of students) {
      const [result] = await connection.execute(
        'INSERT INTO students_data (rfid_number, student_id, full_name, course, gender, year_level) VALUES (?, ?, ?, ?, ?, ?)',
        [student.rfid, student.studentId, student.fullName, student.course, student.gender, student.yearLevel]
      );
      studentDataIds.set(student.studentId, result.insertId);
      await connection.execute('INSERT INTO analytics_mock_students (seed_key, student_data_id) VALUES (?, ?)', [SEED, result.insertId]);
    }

    // One row per visit, linked to the student record.
    const toRow = (type) => (visit) => [studentDataIds.get(visit.studentId), type, visit.timeIn, visit.timeOut];
    const rows = [...attendance.rfidVisits.map(toRow('rfid')), ...attendance.manualVisits.map(toRow('manual'))]
      .sort((x, y) => x[2] - y[2]);
    await insertTracked('attendance', ['student_data_id', 'type', 'time_in', 'time_out'], rows);
    await connection.commit();
    console.log(`Generated ${startDay} through ${localToday}: ${students.length} mock students, ${attendance.rfidVisits.length} RFID visits, ${attendance.manualVisits.length} manual visits.`);
  }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
