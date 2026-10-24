import { useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateLogin } from '../validation.js';
import '../login.css';

const LOGO_SRC = '/images/pcds_logo.png';

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
  };
  switch (name) {
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3.5 7.5l8.5 6 8.5-6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8 10.5V8a4 4 0 018 0v2.5M12 15v2" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'eye-off':
      return (
        <svg {...common}>
          <path d="M3 3l18 18M10.6 6a9.6 9.6 0 011.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 01-3 3.7M6.6 7.6A15.6 15.6 0 002.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 004.2 4.2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      );
  }
}

function LoginField({ label, icon, error, trailing, ...props }) {
  const id = useId();
  return (
    <div className={`lg-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        <Icon name={icon} size={18} />
        {label}
      </label>
      <div className="lg-input">
        <span className="lg-input-icon">
          <Icon name={icon} />
        </span>
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          {...props}
        />
        {trailing}
      </div>
      {error && (
        <p className="lg-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

// Decorative campus scene for the left side. Purely visual.
function CampusArt() {
  const towerRows = [0, 1, 2, 3, 4, 5, 6];
  const slabCols = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <svg
      className="lg-art"
      viewBox="0 0 900 470"
      preserveAspectRatio="xMinYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="lgHillFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d3e8fb" />
          <stop offset="1" stopColor="#e6f2fd" />
        </linearGradient>
        <linearGradient id="lgSwoosh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d9bf7" />
          <stop offset="1" stopColor="#1f6fe0" />
        </linearGradient>
        <linearGradient id="lgSwooshSoft" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8cc3fa" />
          <stop offset="1" stopColor="#c6e2fc" />
        </linearGradient>
        <linearGradient id="lgCard" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a9cf0" />
          <stop offset="1" stopColor="#2a5fc4" />
        </linearGradient>
        <radialGradient id="lgGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* distant hills */}
      <path d="M90 340C210 200 430 140 610 235 700 282 780 300 900 330V470H90Z" fill="url(#lgHillFar)" />
      <path d="M0 300C60 262 130 250 190 282V470H0Z" fill="#dcecfb" />

      {/* trees */}
      <g fill="#b7dbee">
        <circle cx="660" cy="318" r="30" />
        <circle cx="700" cy="296" r="38" />
        <circle cx="742" cy="316" r="32" />
        <circle cx="716" cy="338" r="30" />
        <circle cx="676" cy="342" r="24" />
      </g>
      <g fill="#9ccbe6" opacity="0.8">
        <circle cx="700" cy="306" r="22" />
        <circle cx="730" cy="330" r="18" />
      </g>
      <g fill="#c4e0f4">
        <circle cx="40" cy="352" r="22" />
        <circle cx="70" cy="344" r="26" />
        <circle cx="98" cy="356" r="20" />
      </g>

      {/* building: tall left tower */}
      <rect x="118" y="238" width="84" height="150" fill="#b9d6f3" />
      <rect x="202" y="238" width="14" height="150" fill="#a3c5ea" />
      {/* long slab */}
      <rect x="216" y="286" width="270" height="102" fill="#d0e5f9" />
      <rect x="216" y="278" width="270" height="10" fill="#9fc3ea" />
      {slabCols.map((c) => (
        <g key={`s${c}`}>
          <rect x={228 + c * 25} y="296" width="14" height="16" fill="#e9f4ff" />
          <rect x={228 + c * 25} y="322" width="14" height="16" fill="#a9cdef" />
          <rect x={228 + c * 25} y="348" width="14" height="16" fill="#e1effc" />
        </g>
      ))}
      {/* tall right block */}
      <rect x="430" y="214" width="116" height="174" fill="#b3d1f0" />
      <rect x="546" y="226" width="30" height="162" fill="#98bde6" />
      <rect x="430" y="206" width="116" height="10" fill="#8db6e2" />
      {towerRows.map((r) => (
        <g key={`t${r}`}>
          <rect x="442" y={226 + r * 22} width="20" height="12" fill="#eef7ff" />
          <rect x="470" y={226 + r * 22} width="20" height="12" fill="#a5caee" />
          <rect x="498" y={226 + r * 22} width="20" height="12" fill="#eef7ff" />
        </g>
      ))}
      {towerRows.slice(0, 6).map((r) => (
        <rect key={`l${r}`} x="130" y={252 + r * 22} width="26" height="12" fill={r % 2 ? '#a5caee' : '#e6f3ff'} />
      ))}
      <rect x="164" y="252" width="24" height="124" fill="#a6c9ec" opacity="0.55" />

      {/* ground and swooshes */}
      <path d="M0 372C150 392 330 420 520 470H0Z" fill="url(#lgSwooshSoft)" />
      <path d="M0 410C140 422 270 444 380 470H0Z" fill="url(#lgSwoosh)" />

      {/* floating RFID card */}
      <ellipse cx="318" cy="428" rx="150" ry="22" fill="url(#lgGlow)" />
      <g transform="translate(318 345) rotate(-18)">
        <rect x="-92" y="-58" width="184" height="116" rx="14" fill="#1d4fa8" opacity="0.28" transform="translate(6 10)" />
        <rect x="-92" y="-58" width="184" height="116" rx="14" fill="url(#lgCard)" />
        <path d="M-92 -44a14 14 0 0114-14h74l-90 116v-102z" fill="#ffffff" opacity="0.08" />
        <g fill="none" stroke="#e8f3ff" strokeWidth="5" strokeLinecap="round">
          <path d="M-8 -22a40 40 0 010 44" opacity="0.55" />
          <path d="M8 -34a58 58 0 010 68" opacity="0.8" />
          <path d="M24 -46a76 76 0 010 92" />
        </g>
        <circle cx="-26" cy="0" r="6" fill="#e8f3ff" />
      </g>
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    <div className="lg">
      <CampusArt />

      <section className="lg-left">
        <div className="lg-brand">
          <img src={LOGO_SRC} alt="" width="64" height="64" />
          <div>
            <p className="lg-brand-name">PCDS RFID Kiosk</p>
            <p className="lg-brand-tag">Secure · Simple · Convenient</p>
          </div>
        </div>
        <p className="lg-hero">
          Kiosk administration
          <br />
          for <span>PCDS</span>.
        </p>
      </section>

      <main className="lg-right">
        <div className="lg-card">
          <img className="lg-card-logo" src={LOGO_SRC} alt="Polytechnic College of Davao del Sur seal" />
          <h1>Welcome Back</h1>
          <p className="lg-sub">Sign in to access the PCDS RFID Kiosk system.</p>

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
            <LoginField
              label="Email or ID"
              icon="mail"
              name="identifier"
              type="text"
              autoComplete="username"
              autoFocus
              value={values.identifier}
              onChange={set('identifier')}
              error={errors.identifier}
            />
            <LoginField
              label="Password"
              icon="lock"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={values.password}
              onChange={set('password')}
              error={errors.password}
              trailing={
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  <Icon name={showPassword ? 'eye' : 'eye-off'} />
                </button>
              }
            />
            <button className="lg-btn" type="submit" disabled={submitting}>
              {submitting ? (
                'Signing in…'
              ) : (
                <>
                  <Icon name="arrow" size={22} />
                  Sign in
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
