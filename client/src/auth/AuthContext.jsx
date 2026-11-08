import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearCachedAnswers, setUnauthorizedHandler } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    // The kiosk screen has no sign-in, so there is no session to look up.
    if (window.location.pathname.startsWith('/kiosk')) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    let retry;
    // Only "not signed in" (401) means signed out. A busy server (429), a server
    // error or a dropped connection is retried, so it never looks like a sign-out.
    const check = (attempt) => {
      api('/auth/me')
        .then((data) => {
          if (!active) return;
          setUser(data.user);
          setLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          if (err.status === 401) {
            setUser(null);
            setLoading(false);
          } else {
            retry = setTimeout(() => check(attempt + 1), Math.min(2000 * (attempt + 1), 10000));
          }
        });
    };
    check(0);
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, []);

  const login = useCallback(async (identifier, password, remember = false) => {
    const data = await api('/auth/login', { method: 'POST', body: { identifier, password, remember } });
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    (payload) => api('/auth/register', { method: 'POST', body: payload }),
    []
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clearCachedAnswers();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
