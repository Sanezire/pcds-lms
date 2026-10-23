export function BrandMark({ size = 36 }) {
  return (
    <img
      src="/images/pcds_logo.png"
      alt=""
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="brand">
          <BrandMark />
          <span>PCDS RFID Kiosk</span>
        </div>
        <div className="auth-side-body">
          <h2>Kiosk administration for PCDS.</h2>
          <ul>
            <li>Sign in with your email or admin ID</li>
            <li>Manage accounts, roles and access</li>
            <li>RFID borrowing and returns are added next</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="brand brand-mobile">
            <BrandMark size={30} />
            <span>PCDS RFID Kiosk</span>
          </div>
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
          {children}
          {footer && <p className="auth-footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
