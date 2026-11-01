import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'pcds_theme';
const KIOSK_PATH = /^\/kiosk(\/|$)/;
const META_COLORS = { light: '#f2f8fd', dark: '#07080a' };

const ThemeContext = createContext(null);

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return;
  }
}

function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readStored);
  const [systemDark, setSystemDark] = useState(prefersDark);
  const theme = stored || (systemDark ? 'dark' : 'light');
  const onKiosk = KIOSK_PATH.test(pathname);

  useEffect(() => {
    let query;
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    const onChange = (e) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY || e.key === null) setStored(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const applied = onKiosk ? null : theme;
    if (root.getAttribute('data-theme') !== applied) {
      root.setAttribute('data-no-transition', '');
      if (applied) root.setAttribute('data-theme', applied);
      else root.removeAttribute('data-theme');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => root.removeAttribute('data-no-transition'))
      );
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLORS[applied || 'light']);
  }, [theme, onKiosk]);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setStored(next);
    writeStored(next);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
