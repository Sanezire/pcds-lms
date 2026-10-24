import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { Field } from '../components/Field.jsx';
import { showSuccessToast } from '../toast.js';
import { ArrowRightIcon, CheckIcon, LockIcon, MailIcon } from '../components/Icons.jsx';
import { validateLogin } from '../validation.js';

const REMEMBER_KEY = 'pcds_remembered_id';

function readRemembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

function writeRemembered(value) {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable; skip */
  }
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [remembered] = useState(readRemembered);
  const [remember, setRemember] = useState(Boolean(remembered));
  const [values, setValues] = useState({ identifier: remembered, password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const notice = location.state?.notice;
  const from = location.state?.from;

  // Shown once as a toast, then cleared so a refresh does not show it again.
  useEffect(() => {
    if (!notice) return;
    showSuccessToast(notice);
    navigate(location.pathname, { replace: true, state: from ? { from } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

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
      await login(values.identifier.trim(), values.password, remember);
      writeRemembered(remember ? values.identifier.trim() : '');
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
      title="Welcome Back"
      subtitle="Sign in to access the PCDS RFID Kiosk system."
    >
      {formError && (
        <div className="alert alert-error" role="alert">
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email or ID"
          icon={MailIcon}
          name="identifier"
          autoComplete="username"
          autoFocus={!remembered}
          value={values.identifier}
          onChange={set('identifier')}
          error={errors.identifier}
        />
        <Field
          label="Password"
          icon={LockIcon}
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="check-box" aria-hidden="true">
            <CheckIcon />
          </span>
          Remember me
        </label>
        <button className="btn btn-primary btn-block btn-signin" type="submit" disabled={submitting}>
          {!submitting && <ArrowRightIcon />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
