import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// Adds 10 mock students (and creates the students_data table if it is missing).
// Safe to run again: existing RFID numbers and student IDs are left alone.
// Replace these with real cards and students before real use.
const STUDENTS = [
  // rfid (hex),  student ID,    full name,                  course,                         gender,   year
  ['3E5CCBF0', '2024-2275-9', 'Maria Clara Santos',       'BS Information Technology',    'female', 2],
  ['49C02189', '2023-2187-5', 'Jose Andres Reyes',        'BS Radiologic Technology',     'male',   3],
  ['58932552', '2025-1310-7', 'Angelica Mae Villanueva',  'BS Education',                 'female', 1],
  ['6957C4FF', '2022-3458-2', 'Mark Anthony Bautista',    'BS Business Administration',   'male',   4],
  ['815C7236', '2024-2519-1', 'Kyla Nicole Ramos',        'BS Hospitality Management',    'female', 2],
  ['85CEDE06', '2025-1096-4', 'John Paul Garcia',         'BS Information Technology',    'male',   1],
  ['989DA34B', '2022-3871-6', 'Sofia Isabel Mendoza',     'BS Radiologic Technology',     'female', 4],
  ['B3842312', '2023-2640-8', 'Carlo Miguel Torres',      'BS Education',                 'male',   3],
  ['BF5F4E1C', '2024-2433-3', 'Jasmine Faith Aquino',     'BS Business Administration',   'female', 2],
  ['C890F586', '2025-1188-0', 'Ethan James Navarro',      'BS Hospitality Management',    'male',   1],
];

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  multipleStatements: true,
});

try {
  await connection.query(schema);
  await connection.query(`USE \`${process.env.DB_NAME || 'pcds_lms'}\``);

  let added = 0;
  for (const row of STUDENTS) {
    const [result] = await connection.query(
      `INSERT IGNORE INTO students_data (rfid_number, student_id, full_name, course, gender, year_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row
    );
    added += result.affectedRows;
  }
  console.log(`students_data is ready. Added ${added} of ${STUDENTS.length} mock students.`);
} finally {
  await connection.end();
}
