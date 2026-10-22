import { useId, useState } from 'react';

export function Field({ label, error, hint, type = 'text', ...props }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
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
          >
            {visible ? 'Hide' : 'Show'}
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
