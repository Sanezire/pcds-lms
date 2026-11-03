export const MAX_YEAR_LEVEL = 4;

export function yearText(level) {
  const n = Number(level);
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} Year`;
}

function promote(found) {
  const from = Number(found.year_level);
  const base = { id: found.id, name: found.full_name, from };
  if (found.status === 'inactive') return { ...base, action: 'skipped', reason: 'Student is inactive.' };
  if (from >= MAX_YEAR_LEVEL) {
    return { ...base, action: 'skipped', reason: `Already in ${yearText(from)}, the highest year level.` };
  }
  return { ...base, action: 'promoted', to: from + 1 };
}

export async function registerOrPromote(tx, values) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = await tx.query(
      'SELECT id, full_name, year_level, status FROM students_data WHERE student_id = ? FOR UPDATE',
      [values.studentId]
    );
    if (rows[0]) {
      const outcome = promote(rows[0]);
      if (outcome.action === 'promoted') {
        await tx.query('UPDATE students_data SET year_level = ? WHERE id = ?', [outcome.to, outcome.id]);
      }
      return outcome;
    }

    try {
      const result = await tx.query(
        `INSERT INTO students_data (rfid_number, student_id, full_name, course, gender, year_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [values.rfidNumber, values.studentId, values.fullName, values.course, values.gender, values.yearLevel]
      );
      return { action: 'added', id: result.insertId, name: values.fullName };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      if (String(err.sqlMessage).includes('uq_students_data_rfid')) {
        return { action: 'failed', reason: 'This RFID number is already assigned to another student.' };
      }
    }
  }
  return { action: 'failed', reason: 'The record changed while it was being saved. Try again.' };
}
