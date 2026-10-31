// auth.tsx - remembers WHO is logged in, for every screen.
//
// WHY a "context"? Many screens (nav bar, protected pages, booking form) need
// the current user. A React context is a shared box any component can read
// with useAuth(), instead of passing `user` down through every component.
//
// We never see the login cookie (it's httpOnly). To know who we are, we ask
// the API: GET /auth/me. 200 = logged in (with role), 401 = not logged in.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import type { Role, User } from './api';
import { Loading } from './components';

interface AuthState {
  user: User | null;
  loading: boolean;                       // true until the first /auth/me answers
  login: (email: string, password: string) => Promise<User>;
  signup: (d: { email: string; password: string; full_name: string; phone: string }) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load (or page refresh) ask the API who we are.
  useEffect(() => {
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))         // 401 = simply not logged in
      .finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user, loading,
    login: async (email, password) => { const r = await api.login(email, password); setUser(r.user); return r.user; },
    signup: async (d) => { const r = await api.signup(d); setUser(r.user); return r.user; },
    logout: async () => { await api.logout().catch(() => {}); setUser(null); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// Where each role lands after logging in.
// eslint-disable-next-line react-refresh/only-export-components
export function homeFor(role: Role): string {
  return role === 'GUEST' ? '/search' : role === 'ADMIN' ? '/admin' : '/bookings';
}

// <RequireRole roles={['MANAGER','ADMIN']}> page </RequireRole>
//  - not logged in  -> go to /login (and come back here afterwards)
//  - wrong role     -> "not allowed" message
// NOTE: this only HIDES screens. The real protection is the API, which checks
// the role on every request. Never trust the browser alone.
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!roles.includes(user.role)) return <p className="msg msg-error">You don't have permission to open this page.</p>;
  return <>{children}</>;
}
