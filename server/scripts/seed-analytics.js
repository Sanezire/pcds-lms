import 'dotenv/config';
import mysql from 'mysql2/promise';

// Deterministic five-year analytics fixture. It owns only rows recorded in the
// analytics_mock_* tables, so --replace can safely remove and rebuild its data.
const SEED = 'analytics-five-years-v1';
const OFFSET = Number.parseInt(process.env.ATTENDANCE_UTC_OFFSET_MINUTES ?? '480', 10) || 480;
const COURSES = [
  'BS Information Technology', 'BS Radiologic Technology', 'BS Education',
  'BS Business Administration', 'BS Hospitality Management', 'BS Psychology',
  'BS Nursing', 'BS Criminology',
];
const FIRST_NAMES = ['Alex', 'Andrea', 'Angel', 'Bea', 'Carlo', 'Dani', 'Ethan', 'Faith', 'Gabriel', 'Hannah', 'Ivan', 'Jasmine', 'Kyla', 'Liam', 'Maria', 'Noah', 'Olivia', 'Paolo', 'Rafael', 'Sofia'];
const LAST_NAMES = ['Aquino', 'Bautista', 'Cruz', 'Dela Rosa', 'Garcia', 'Lim', 'Mendoza', 'Navarro', 'Reyes', 'Santos', 'Tan', 'Villanueva'];
const TOTAL_STUDENTS = 120;
const MS_DAY = 86_400_000;

let state = 0x5eed1234;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x1_0000_0000;
}
const pick = (items) => items[Math.floor(random() * items.length)];
const pad = (n, width = 2) => String(n).padStart(width, '0');
const dateKey = (date) => date.toISOString().slice(0, 10);
const localToday = dateKey(new Date(Date.now() + OFFSET * 60_000));
const end = new Date(`${localToday}T00:00:00Z`);
const start = new Date(Date.UTC(end.getUTCFullYear() - 5, end.getUTCMonth(), end.getUTCDate()));
const startDay = dateKey(start);

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'pcds_lms',
});

function check(result, context) {
  if (!result.affectedRows) throw new Error(`Could not ${context}; a generated student ID or RFID may already be in use.`);
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
      source_table ENUM('attendance', 'manual_attendance') NOT NULL,
      source_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (seed_key, source_table, source_id)
    ) ENGINE=InnoDB`);

  const replace = process.argv.includes('--replace');
  await connection.beginTransaction();
  const [batches] = await connection.execute('SELECT seed_key FROM analytics_mock_batches WHERE seed_key = ? FOR UPDATE', [SEED]);
  if (batches.length && !replace) {
    await connection.rollback();
    console.log(`Analytics mock data already exists (${SEED}). Use --replace to rebuild only its tracked rows.`);
    process.exitCode = 0;
  } else {
    if (batches.length) {
      const [ownedRows] = await connection.execute('SELECT source_table, source_id FROM analytics_mock_rows WHERE seed_key = ?', [SEED]);
      const rfidIds = ownedRows.filter((r) => r.source_table === 'attendance').map((r) => r.source_id);
      const manualIds = ownedRows.filter((r) => r.source_table === 'manual_attendance').map((r) => r.source_id);
      for (const [table, ids] of [['attendance', rfidIds], ['manual_attendance', manualIds]]) {
        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500);
          if (slice.length) await connection.query(`DELETE FROM ${table} WHERE id IN (${slice.map(() => '?').join(',')})`, slice);
        }
      }
      await connection.execute('DELETE FROM analytics_mock_rows WHERE seed_key = ?', [SEED]);
      const [ownedStudents] = await connection.execute('SELECT student_data_id FROM analytics_mock_students WHERE seed_key = ?', [SEED]);
      const ids = ownedStudents.map((s) => s.student_data_id);
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        if (slice.length) await connection.query(`DELETE FROM students_data WHERE id IN (${slice.map(() => '?').join(',')})`, slice);
      }
      await connection.execute('DELETE FROM analytics_mock_students WHERE seed_key = ?', [SEED]);
    }

    const [batchInsert] = await connection.execute('INSERT INTO analytics_mock_batches (seed_key) VALUES (?) ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP', [SEED]);
    void batchInsert;
    const students = [];
    for (let i = 0; i < TOTAL_STUDENTS; i += 1) {
      const studentId = `2099-${String(9000 + i).slice(-4)}-${i % 10}`;
      const rfid = (0xf0000000 + i).toString(16).toUpperCase();
      const fullName = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]} ${String.fromCharCode(65 + (i % 26))}`;
      const course = COURSES[i % COURSES.length];
      const gender = i % 20 === 0 ? 'other' : i % 2 === 0 ? 'female' : 'male';
      const yearLevel = (i % 6) + 1;
      const [insert] = await connection.execute(
        'INSERT INTO students_data (rfid_number, student_id, full_name, course, gender, year_level) VALUES (?, ?, ?, ?, ?, ?)',
        [rfid, studentId, fullName, course, gender, yearLevel]
      );
      check(insert, 'insert a mock student');
      students.push({ id: insert.insertId, studentId, fullName, course, gender, yearLevel });
      await connection.execute('INSERT INTO analytics_mock_students (seed_key, student_data_id) VALUES (?, ?)', [SEED, insert.insertId]);
    }

    const rfidRows = [];
    const manualRows = [];
    const MS_MINUTE = 60_000;
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
        const inAt = new Date(localStartMs - OFFSET * MS_MINUTE);
        const duration = 12 + Math.floor(random() * 188);
        const typeManual = random() < 0.23;
        const endsOpen = dateKey(day) === localToday && random() < 0.035;
        const outAt = endsOpen ? null : new Date(inAt.getTime() + duration * MS_MINUTE);
        if (typeManual) {
          manualRows.push([student.studentId, student.fullName, student.course, student.yearLevel, student.gender, inAt, outAt]);
        } else {
          rfidRows.push([student.id, 'in', inAt], [student.id, 'out', outAt || new Date(inAt.getTime() + duration * MS_MINUTE)]);
        }
        // A second visit from the same student on the same day should still count once.
        if (random() < 0.11) {
          const secondIn = new Date(localStartMs + (240 + Math.floor(random() * 180)) * MS_MINUTE - OFFSET * MS_MINUTE);
          const secondOut = new Date(secondIn.getTime() + (15 + Math.floor(random() * 120)) * MS_MINUTE);
          if (typeManual) {
            manualRows.push([student.studentId, student.fullName, student.course, student.yearLevel, student.gender, secondIn, secondOut]);
          } else {
            rfidRows.push([student.id, 'in', secondIn], [student.id, 'out', secondOut]);
          }
        }
      }
    }

    const insertTracked = async (table, columns, values, transform = (id) => [SEED, table, id]) => {
      const ids = [];
      const size = table === 'attendance' ? 400 : 400;
      for (let i = 0; i < values.length; i += size) {
        const batch = values.slice(i, i + size);
        const tuple = `(${columns.map(() => '?').join(',')})`;
        const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`;
        const flat = batch.flat();
        const [result] = await connection.query(sql, flat);
        for (let j = 0; j < result.affectedRows; j += 1) ids.push(Number(result.insertId) + j);
      }
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500).map((id) => transform(id));
        if (!batch.length) continue;
        await connection.query(`INSERT INTO analytics_mock_rows (seed_key, source_table, source_id) VALUES ${batch.map(() => '(?,?,?)').join(',')}`, batch.flat());
      }
      return ids.length;
    };

    rfidRows.sort((a, b) => Number(a[0]) - Number(b[0]) || a[2] - b[2] || (a[1] === 'in' ? -1 : 1));
    const rfidCount = await insertTracked('attendance', ['student_data_id', 'action', 'recorded_at'], rfidRows);
    const manualCount = await insertTracked('manual_attendance', ['student_id', 'student_name', 'course', 'year_level', 'gender', 'time_in', 'time_out'], manualRows);
    await connection.commit();
    console.log(`Generated ${startDay} through ${localToday}: ${students.length} mock students, ${Math.ceil(rfidCount / 2)} RFID visits (${rfidCount} taps), ${manualCount} manual visits.`);
  }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
