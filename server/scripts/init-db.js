import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

try {
  await connection.query(sql);

  // CREATE TABLE IF NOT EXISTS does not change tables that already exist, so
  // columns added later are applied here. Safe to run any number of times.
  const [found] = await connection.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'message_rules' AND column_name = 'message_out'`
  );
  if (!found[0].n) {
    await connection.query(
      `ALTER TABLE message_rules ADD COLUMN message_out VARCHAR(500) NOT NULL DEFAULT '' AFTER message`
    );
    console.log('Added message_rules.message_out.');
  }

  console.log('Database schema is ready.');
} finally {
  await connection.end();
}
