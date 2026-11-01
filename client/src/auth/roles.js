// Mirrors the server's role groups. The server enforces them; these only decide
// what to show.
export const MANAGER_ROLES = ['super_admin', 'admin', 'librarian'];
export const ATTENDANCE_ROLES = [...MANAGER_ROLES, 'student_assistant'];
export const SUPER_ADMIN_ONLY = ['super_admin'];
// Who may choose which programs and year levels go into a printed report.
export const REPORT_CHOOSER_ROLES = ['super_admin', 'admin'];

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  librarian: 'Librarian',
  student_assistant: 'SA',
  student: 'Student',
};
export const roleLabel = (role) => ROLE_LABELS[role] || role;
