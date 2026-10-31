import { query } from './db.js';
import { AUDITED_ROLES } from './config.js';
import { publish } from './events.js';

// Writes one line to the audit log for an action by an admin, student assistant or
// super admin. `actor` defaults to the signed-in user; sign-in and registration pass
// the account explicitly. A failure here is logged but never blocks the action itself.
export async function recordAudit(req, action, details = '', actor = req?.user) {
  if (!actor || !AUDITED_ROLES.includes(actor.role)) return;
  try {
    await query(
      `INSERT INTO audit_logs (user_id, user_name, member_id, user_role, action, details, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        actor.id,
        String(actor.full_name).slice(0, 100),
        String(actor.member_id).slice(0, 32),
        actor.role,
        action,
        String(details).slice(0, 500),
        (req?.ip || '').slice(0, 45) || null,
      ]
    );
    publish('audit');
  } catch (err) {
    console.error('Could not write the audit log:', err.message);
  }
}
