import { useTheme } from '../theme/ThemeContext.jsx';
import { MoonIcon, SunIcon } from './Icons.jsx';

export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
