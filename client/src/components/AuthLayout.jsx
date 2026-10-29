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

/* The RFID gif is a 640px canvas with the artwork centred in the middle 224px.
   Crop to that artwork so it renders at the same visual size as the school logo. */
export function RfidMark({ size = 84 }) {
  return (
    <span className="rfid-mark" style={{ width: size, height: size }}>
      <img src="/images/rfid_icon.gif" alt="" />
    </span>
  );
}

/* Soft campus-and-card illustration for the lower left of the page. */
function CampusScene() {
  return (
    <svg
      className="auth-scene"
      viewBox="0 0 900 420"
      preserveAspectRatio="xMinYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sc-hill-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfe5f8" />
          <stop offset="1" stopColor="#e4f1fc" />
        </linearGradient>
        <linearGradient id="sc-hill-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fb8f2" />
          <stop offset="1" stopColor="#2f86e8" />
        </linearGradient>
        <linearGradient id="sc-hill-mid" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a9d3f7" />
          <stop offset="1" stopColor="#d5eafb" />
        </linearGradient>
        <linearGradient id="sc-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b9bea" />
          <stop offset="1" stopColor="#2a6fd6" />
        </linearGradient>
        <linearGradient id="sc-building" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c3dcf3" />
          <stop offset="1" stopColor="#dcecfa" />
        </linearGradient>
      </defs>

      {/* back hills */}
      <path d="M0 250 C120 170 240 190 360 150 C470 115 560 120 640 150 L640 420 L0 420Z" fill="url(#sc-hill-back)" opacity="0.8" />
      <path d="M0 300 C90 270 150 250 230 270 L230 420 L0 420Z" fill="#cde3f6" opacity="0.7" />

      {/* buildings */}
      <g opacity="0.95">
        <rect x="90" y="190" width="70" height="140" fill="url(#sc-building)" />
        <rect x="160" y="230" width="270" height="110" fill="url(#sc-building)" />
        <rect x="330" y="140" width="170" height="200" fill="#bcd8f1" />
        <rect x="400" y="115" width="140" height="225" fill="#d3e7f8" />
        <g fill="#eef6fd" opacity="0.9">
          {Array.from({ length: 11 }).map((_, i) => (
            <rect key={`a${i}`} x={172 + i * 24} y="248" width="14" height="14" rx="1.5" />
          ))}
          {Array.from({ length: 11 }).map((_, i) => (
            <rect key={`b${i}`} x={172 + i * 24} y="280" width="14" height="14" rx="1.5" />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <rect key={`c${i}`} x={412 + i * 24} y="140" width="14" height="22" rx="1.5" />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <rect key={`d${i}`} x={412 + i * 24} y="190" width="14" height="22" rx="1.5" />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <rect key={`e${i}`} x={412 + i * 24} y="240" width="14" height="22" rx="1.5" />
          ))}
          <rect x="102" y="210" width="46" height="12" rx="1.5" />
          <rect x="102" y="240" width="46" height="12" rx="1.5" />
          <rect x="102" y="270" width="46" height="12" rx="1.5" />
        </g>
      </g>

      {/* trees */}
      <g fill="#a8d0ec" opacity="0.9">
        <circle cx="585" cy="270" r="30" />
        <circle cx="620" cy="250" r="38" />
        <circle cx="660" cy="272" r="30" />
        <circle cx="640" cy="295" r="28" />
        <circle cx="30" cy="330" r="22" />
        <circle cx="60" cy="338" r="18" />
      </g>

      {/* ground and hills in front */}
      <path d="M0 330 C170 345 360 360 560 345 C700 335 790 320 900 330 L900 420 L0 420Z" fill="url(#sc-hill-mid)" />
      <path d="M0 305 C120 320 230 360 330 420 L0 420Z" fill="#8cc2f4" opacity="0.65" />
      <path d="M0 360 C80 345 180 375 270 420 L0 420Z" fill="url(#sc-hill-front)" />

      {/* RFID card */}
      <g transform="translate(265 305) rotate(-14)">
        <circle cx="95" cy="52" r="108" fill="#ffffff" opacity="0.35" />
        <rect x="0" y="0" width="190" height="112" rx="14" fill="url(#sc-card)" />
        <rect x="0" y="0" width="190" height="112" rx="14" fill="none" stroke="#ffffff" strokeOpacity="0.35" />
        <g fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.9">
          <path d="M92 38 C108 46 108 66 92 74" />
          <path d="M108 28 C134 42 134 70 108 84" opacity="0.8" />
          <path d="M124 18 C160 38 160 74 124 94" opacity="0.6" />
        </g>
        <circle cx="76" cy="56" r="7" fill="#ffffff" />
      </g>
    </svg>
  );
}

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="auth-brand">
          <BrandMark size={72} />
          <div>
            <p className="auth-brand-name">PCDS LRC</p>
            <p className="auth-brand-tag">Secure · Simple · Convenient</p>
          </div>
        </div>
        <h2 className="auth-headline">
          Kiosk administration
          <br />
          for <span>PCDS</span>.
        </h2>
        <CampusScene />
      </section>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-logo">
            <RfidMark size={84} />
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
