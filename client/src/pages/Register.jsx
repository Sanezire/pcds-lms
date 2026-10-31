import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { Field } from '../components/Field.jsx';
import { validateRegister } from '../validation.js';
import { showSuccessToast } from '../toast.js';

const EMPTY = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: '',
  registrationKey: '',
};

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'student_assistant', label: 'SA (Student Assistant)' },
];

// The ID is assigned by the server from the role; this only shows its shape.
const ID_SHAPE = { admin: 'AD-####', student_assistant: 'SA-####' };
const ROLE_NAME = { admin: 'Admin', student_assistant: 'Student Assistant' };

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null); // { memberId, role } once the account exists

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  // Check the confirmation as soon as the person leaves that field.
  const checkConfirm = () => {
    if (values.confirmPassword && values.password !== values.confirmPassword) {
      setErrors((er) => ({ ...er, confirmPassword: 'Passwords do not match.' }));
    }
  };

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');

    const found = validateRegister(values);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementsByName(Object.keys(found)[0])[0]?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(values);
      setCreated({ memberId: result.memberId, role: values.role });
      setSubmitting(false);
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setSubmitting(false);
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(created.memberId);
      showSuccessToast('ID copied');
    } catch {
      /* clipboard blocked: the ID is on screen to copy by hand */
    }
  }

  if (created) {
    return (
      <AuthLayout
        title="Account created"
        subtitle={`Your ${ROLE_NAME[created.role]} account is ready. Use this ID, or your email, to sign in.`}
      >
        <div className="new-id" role="status">
          <span className="new-id-label">Your ID</span>
          <strong className="new-id-value">{created.memberId}</strong>
          <button type="button" className="btn btn-quiet" onClick={copyId}>
            Copy ID
          </button>
        </div>
        <button className="btn btn-primary btn-block" type="button" onClick={() => navigate('/login', { replace: true })}>
          Continue to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Register account"
      subtitle="Create an Admin or Student Assistant (SA) account. This needs the registration key."
      footer={
        <>
          Already registered? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Full name"
          name="fullName"
          autoComplete="name"
          autoFocus
          value={values.fullName}
          onChange={set('fullName')}
          error={errors.fullName}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <div className={`field${errors.role ? ' has-error' : ''}`}>
          <label htmlFor="reg-role">Role</label>
          <div className="input-wrap">
            <select
              id="reg-role"
              name="role"
              className="field-select"
              value={values.role}
              onChange={set('role')}
              aria-invalid={errors.role ? 'true' : undefined}
              aria-describedby={errors.role ? 'reg-role-err' : undefined}
            >
              <option value="">Select a role</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {errors.role && (
            <p className="error-text" id="reg-role-err">
              {errors.role}
            </p>
          )}
        </div>
        <Field
          label="ID"
          name="memberId"
          readOnly
          tabIndex={-1}
          autoComplete="off"
          value={ID_SHAPE[values.role] || ''}
          placeholder="Choose a role first"
          hint="Assigned automatically when the account is created, based on the role."
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with uppercase, lowercase and a number."
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={set('confirmPassword')}
          onBlur={checkConfirm}
          error={errors.confirmPassword}
        />
        <Field
          label="Registration key"
          name="registrationKey"
          type="password"
          autoComplete="off"
          value={values.registrationKey}
          onChange={set('registrationKey')}
          error={errors.registrationKey}
        />
        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
