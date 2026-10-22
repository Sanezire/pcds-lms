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
          <span>PCDS LMS</span>
        </div>
        <div className="auth-side-body">
          <h2>Library services for students and staff.</h2>
          <ul>
            <li>Find and reserve books from any device</li>
            <li>See what you have borrowed and when it is due</li>
            <li>Librarians manage the catalogue and members in one place</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="brand brand-mobile">
            <BrandMark size={30} />
            <span>PCDS LMS</span>
          </div>
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
          {children}
          <p className="auth-footer">{footer}</p>
        </div>
      </main>
    </div>
  );
}
