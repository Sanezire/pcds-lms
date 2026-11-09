import { query, withTransaction } from './db.js';

// Database backup as a .sql file, and restoring one.
//
// The export holds the data of every table except sign-in sessions, as plain SQL
// (DELETE + INSERT per table), so it can also be opened or run in MySQL Workbench
// or phpMyAdmin against a PCDS LRC database. The import only accepts files made by
// this export: it reads the statements itself (no SQL from the file is run as-is),
// checks every table and column against this database, and replaces the data of
// those tables in one transaction, so a bad file changes nothing.

export const BACKUP_HEADER = '-- PCDS LRC database backup';
const SKIP_TABLES = new Set(['sessions']);
const ROWS_PER_INSERT = 250;

async function backupTables() {
  const tables = await query(
    `SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  const cols = await query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND extra NOT LIKE '%GENERATED%'
      ORDER BY table_name, ordinal_position`
  );
  const byTable = new Map();
  for (const { t } of tables) if (!SKIP_TABLES.has(t)) byTable.set(t, []);
  for (const { t, c } of cols) byTable.get(t)?.push(c);
  return byTable;
}

const ident = (name) => `\`${String(name).replace(/`/g, '``')}\``;
const pad = (n) => String(n).padStart(2, '0');

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) {
    return `'${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}'`;
  }
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  const s = String(v).replace(/[\0\n\r\b\t\x1a'"\\]/g, (ch) =>
    ({ '\0': '\\0', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\t': '\\t', '\x1a': '\\Z', "'": "\\'", '"': '\\"', '\\': '\\\\' })[ch]
  );
  return `'${s}'`;
}

// Builds the whole backup. Returns { sql, counts }.
export async function exportDatabase() {
  const tables = await backupTables();
  const counts = {};
  const out = [
    BACKUP_HEADER,
    `-- Exported ${new Date().toISOString()} (times in the file are UTC)`,
    '-- Restore it on the Settings screen (Database > Import). It replaces the data in every table',
    '-- below; sign-in sessions are not included.',
    'SET FOREIGN_KEY_CHECKS=0;',
    '',
  ];
  for (const [table, columns] of tables) {
    const rows = await query(`SELECT ${columns.map(ident).join(', ')} FROM ${ident(table)} ORDER BY 1`);
    counts[table] = rows.length;
    out.push(`-- ${table}: ${rows.length} rows`, `DELETE FROM ${ident(table)};`);
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const part = rows.slice(i, i + ROWS_PER_INSERT);
      out.push(
        `INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES\n` +
          part.map((r) => `(${columns.map((c) => literal(r[c])).join(', ')})`).join(',\n') +
          ';'
      );
    }
    out.push('');
  }
  out.push('SET FOREIGN_KEY_CHECKS=1;', '');
  return { sql: out.join('\n'), counts };
}

// ---- Import ---------------------------------------------------------------

class BackupError extends Error {}

// Reads the statements of a backup file. Only the shapes the export writes are
// accepted: SET FOREIGN_KEY_CHECKS, DELETE FROM `t`, INSERT INTO `t` (...) VALUES (...).
function parseBackup(text) {
  let i = 0;
  const n = text.length;
  const lineAt = (pos) => text.slice(0, pos).split('\n').length;
  const fail = (what) => {
    throw new BackupError(`This file is not a PCDS LRC backup, or it was changed (${what} on line ${lineAt(i)}).`);
  };

  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i += 1;
      if (text.startsWith('--', i)) {
        const end = text.indexOf('\n', i);
        i = end < 0 ? n : end + 1;
      } else if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i);
        if (end < 0) fail('unclosed comment');
        i = end + 2;
      } else return;
    }
  };
  const word = (w) => {
    skip();
    if (text.slice(i, i + w.length).toUpperCase() !== w) return false;
    i += w.length;
    return true;
  };
  const expect = (w) => {
    if (!word(w)) fail(`expected ${w}`);
  };
  const name = () => {
    skip();
    if (text[i] !== '`') fail('expected a name');
    let out = '';
    i += 1;
    while (i < n) {
      if (text[i] === '`') {
        if (text[i + 1] === '`') {
          out += '`';
          i += 2;
          continue;
        }
        i += 1;
        return out;
      }
      out += text[i];
      i += 1;
    }
    return fail('unclosed name');
  };
  const ESC = { 0: '\0', n: '\n', r: '\r', b: '\b', t: '\t', Z: '\x1a' };
  const value = () => {
    skip();
    if (word('NULL')) return null;
    if (text[i] === "'") {
      i += 1;
      let out = '';
      while (i < n) {
        const ch = text[i];
        if (ch === '\\') {
          const next = text[i + 1];
          out += ESC[next] ?? next;
          i += 2;
        } else if (ch === "'") {
          if (text[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i += 1;
            return out;
          }
        } else {
          out += ch;
          i += 1;
        }
      }
      return fail('unclosed text');
    }
    if ((text[i] === 'X' || text[i] === 'x') && text[i + 1] === "'") {
      const end = text.indexOf("'", i + 2);
      const hex = text.slice(i + 2, end);
      if (end < 0 || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) fail('bad binary value');
      i = end + 1;
      return Buffer.from(hex, 'hex');
    }
    const m = /^-?\d+(\.\d+)?/.exec(text.slice(i, i + 40));
    if (!m) fail('unexpected value');
    i += m[0].length;
    return m[0];
  };
  const list = (item) => {
    expect('(');
    const out = [item()];
    while (word(',')) out.push(item());
    expect(')');
    return out;
  };

  const statements = [];
  for (;;) {
    skip();
    if (i >= n) break;
    if (word('SET')) {
      expect('FOREIGN_KEY_CHECKS');
      expect('=');
      if (!word('0') && !word('1')) fail('expected 0 or 1');
    } else if (word('DELETE')) {
      expect('FROM');
      statements.push({ kind: 'delete', table: name() });
    } else if (word('INSERT')) {
      expect('INTO');
      const table = name();
      const columns = list(name);
      expect('VALUES');
      const rows = [list(value)];
      while (word(',')) rows.push(list(value));
      if (rows.some((r) => r.length !== columns.length)) fail('wrong number of values');
      statements.push({ kind: 'insert', table, columns, rows });
    } else fail('unexpected statement');
    expect(';');
  }
  return statements;
}

// Replaces the data of the tables in the backup. Returns { counts }.
export async function importDatabase(text) {
  if (!text.startsWith(BACKUP_HEADER)) {
    throw new BackupError('This file is not a PCDS LRC backup. Use a .sql file made with Export on this screen.');
  }
  const statements = parseBackup(text);
  const tables = await backupTables();
  const deleted = new Set();
  for (const st of statements) {
    const columns = tables.get(st.table);
    if (!columns) throw new BackupError(`The backup has a table this database does not have: ${st.table}.`);
    if (st.kind === 'delete') deleted.add(st.table);
    else {
      if (!deleted.has(st.table)) throw new BackupError(`The backup adds rows to ${st.table} without replacing it first.`);
      const unknown = st.columns.filter((c) => !columns.includes(c));
      if (unknown.length) {
        throw new BackupError(`The backup is from a different version: ${st.table} has no column ${unknown.join(', ')}.`);
      }
    }
  }
  if (!deleted.size) throw new BackupError('The backup has no tables in it.');

  const counts = {};
  await withTransaction(async (tx) => {
    await tx.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const st of statements) {
        if (st.kind === 'delete') {
          await tx.query(`DELETE FROM ${ident(st.table)}`);
          counts[st.table] = 0;
          continue;
        }
        const marks = `(${st.columns.map(() => '?').join(', ')})`;
        for (let k = 0; k < st.rows.length; k += ROWS_PER_INSERT) {
          const part = st.rows.slice(k, k + ROWS_PER_INSERT);
          await tx.query(
            `INSERT INTO ${ident(st.table)} (${st.columns.map(ident).join(', ')}) VALUES ${part.map(() => marks).join(', ')}`,
            part.flat()
          );
        }
        counts[st.table] += st.rows.length;
      }
      // Never leave the system without anyone who can sign in to fix it.
      const [admins] = await tx.query("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active'");
      if (!Number(admins.n)) {
        throw new BackupError('This backup has no active super admin account, so nobody could sign in afterwards. Nothing was changed.');
      }
      // Sign-ins of accounts that are not in the backup end here.
      await tx.query('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)');
    } finally {
      await tx.query('SET FOREIGN_KEY_CHECKS=1');
    }
  });
  return { counts };
}

export { BackupError };
