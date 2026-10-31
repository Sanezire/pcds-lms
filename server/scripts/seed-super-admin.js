import bcrypt from 'bcrypt';
import { config } from '../src/config.js';
import { query, pool } from '../src/db.js';
import { validateRegistration } from '../src/validation.js';
import { ensureSchema } from '../src/migrate.js';

// Creates (or promotes) the super admin from the SEED_SUPER_ADMIN_* values in .env.
const { errors, values } = validateRegistration({
  fullName: process.env.SEED_SUPER_ADMIN_NAME,
  email: process.env.SEED_SUPER_ADMIN_EMAIL,
  memberId: process.env.SEED_SUPER_ADMIN_ID,
  password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  confirmPassword: process.env.SEED_SUPER_ADMIN_PASSWORD,
  role: 'admin',
  registrationKey: 'seed', // not used; the seed script writes directly to the database
});

if (Object.keys(errors).length) {
  console.error('Invalid SEED_SUPER_ADMIN_* values:', errors);
  process.exit(1);
}

try {
  await ensureSchema(); // makes sure the super_admin role exists in an older database
  const hash = await bcrypt.hash(values.password, config.bcryptRounds);
  await query(
    `INSERT INTO users (full_name, email, member_id, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'super_admin', 'active')
     ON DUPLICATE KEY UPDATE role = 'super_admin', status = 'active'`,
    [values.fullName, values.email, values.memberId, hash]
  );
  console.log(`Super admin ready: ${values.email}`);
} finally {
  await pool.end();
}
