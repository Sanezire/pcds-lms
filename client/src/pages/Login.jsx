import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { Field } from '../components/Field.jsx';
import { validateLogin } from '../validation.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const notice = location.state?.notice;
  const from = location.state?.from;

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');

    const found = validateLogin(values);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementsByName(Object.keys(found)[0])[0]?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await login(values.identifier.trim(), values.password);
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields || {});
      setValues((v) => ({ ...v, password: '' }));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your email or student/staff ID."
      footer={
        <>
          New to PCDS LMS? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email or student/staff ID"
          name="identifier"
          autoComplete="username"
          autoFocus
          value={values.identifier}
          onChange={set('identifier')}
          error={errors.identifier}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
