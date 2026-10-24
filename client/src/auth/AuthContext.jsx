import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    let active = true;
    api('/auth/me')
      .then((data) => active && setUser(data.user))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { identifier, password } });
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
      setUser(null);
    }
  }, []);

  // Reloads the signed-in account. If the session was ended on the server
  // (role changed, account suspended), the user is signed out right away.
  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/me');
      setUser(data.user);
    } catch {
      /* keep the current user on a network error */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
