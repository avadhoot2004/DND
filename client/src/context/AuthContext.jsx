import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, fetchCsrfToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check active session on initial page load
  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const res = await api.getCurrentUser();
        setUser(res.data?.user || null);
        if (res.data?.user) {
          try {
            await fetchCsrfToken();
          } catch (csrfErr) {
            console.warn('Failed to fetch CSRF token on initial session load:', csrfErr);
          }
        }
      } catch (err) {
        // Not logged in or session expired
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    loadCurrentUser();
  }, []);

  const login = async (email, password) => {
    setError(null);
    try {
      const res = await api.login({ email, password });
      setUser(res.data.user);
      try {
        await fetchCsrfToken();
      } catch (csrfErr) {
        console.warn('Failed to fetch CSRF token after login:', csrfErr);
      }
      return { success: true, user: res.data.user };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const register = async (userData) => {
    setError(null);
    try {
      const res = await api.register(userData);
      setUser(res.data.user);
      try {
        await fetchCsrfToken();
      } catch (csrfErr) {
        console.warn('Failed to fetch CSRF token after registration:', csrfErr);
      }
      return { success: true, user: res.data.user };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        register,
        logout,
        isAuthenticated: Boolean(user),
        isAdmin: user?.role === 'ADMIN',
        isStaff: user?.role === 'STAFF' || user?.role === 'ADMIN'
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
