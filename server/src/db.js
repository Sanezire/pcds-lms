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

const MAX_TX_ATTEMPTS = 3;

export async function withTransaction(work) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const tx = { query: async (sql, params = []) => (await conn.execute(sql, params))[0] };
      const result = await work(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_TX_ATTEMPTS) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}
