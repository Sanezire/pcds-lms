import bcrypt from 'bcrypt';
import { config } from '../src/config.js';
import { query, pool } from '../src/db.js';
import { validateRegistration } from '../src/validation.js';

// Creates (or promotes) the first administrator from the SEED_ADMIN_* values in .env.
const { errors, values } = validateRegistration({
  fullName: process.env.SEED_ADMIN_NAME,
  email: process.env.SEED_ADMIN_EMAIL,
  memberId: process.env.SEED_ADMIN_ID,
  password: process.env.SEED_ADMIN_PASSWORD,
  confirmPassword: process.env.SEED_ADMIN_PASSWORD,
  registrationKey: 'seed', // not used; the seed script writes directly to the database
});

if (Object.keys(errors).length) {
  console.error('Invalid SEED_ADMIN_* values:', errors);
  process.exit(1);
}

try {
  const hash = await bcrypt.hash(values.password, config.bcryptRounds);
  await query(
    `INSERT INTO users (full_name, email, member_id, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'admin', 'active')
     ON DUPLICATE KEY UPDATE role = 'admin', status = 'active'`,
    [values.fullName, values.email, values.memberId, hash]
  );
  console.log(`Administrator ready: ${values.email}`);
} finally {
  await pool.end();
}
