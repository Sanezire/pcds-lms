import { useId, useState } from 'react';
import { EyeIcon, EyeOffIcon } from './Icons.jsx';

export function Field({ label, error, hint, icon: Icon, type = 'text', ...props }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');

  return (
    <div className={`field${error ? ' has-error' : ''}${Icon ? ' has-icon' : ''}`}>
      <label htmlFor={id}>
        {Icon && <Icon className="label-icon" />}
        {label}
      </label>
      <div className="input-wrap">
        {Icon && <Icon className="input-icon" />}
        <input
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            className="toggle"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        )}
      </div>
      {hint && !error && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="error-text" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}
