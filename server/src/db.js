import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: false,
  timezone: 'Z',
});

// Every query goes through execute(), which uses server-side prepared
// statements, so user input is never concatenated into SQL.
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
