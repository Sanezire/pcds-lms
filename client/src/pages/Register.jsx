import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { Field } from '../components/Field.jsx';
import { validateRegister } from '../validation.js';

const EMPTY = {
  fullName: '',
  email: '',
  memberId: '',
  password: '',
  confirmPassword: '',
  role: '',
  registrationKey: '',
};

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'student_assistant', label: 'SA (Student Assistant)' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      await register(values);
      navigate('/login', {
        replace: true,
        state: { notice: `${values.role === 'admin' ? 'Admin' : 'Student Assistant'} account created. Sign in to continue.` },
      });
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setSubmitting(false);
    }
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
          autoComplete="off"
          value={values.memberId}
          onChange={set('memberId')}
          error={errors.memberId}
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
