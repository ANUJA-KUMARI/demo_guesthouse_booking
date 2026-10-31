// Login screen - for guests, managers and admins alike.
// The API decides the role; we just send each role to its start page.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { homeFor, useAuth } from '../auth';
import { Message } from '../components';
import { errorText } from '../format';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  // If RequireRole sent us here, it saved the page we wanted in location.state.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={homeFor(user.role)} replace />;   // already logged in

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const u = await login(email, password);
      navigate(from ?? homeFor(u.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(err.message);     // too many tries
      else if (err instanceof ApiError && err.status === 401) setError('Wrong email or password.');
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-box">
      <h1>Log in</h1>
      <form className="card form" onSubmit={submit}>
        <label>Email <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <Message kind="error">{error}</Message>
      <p className="muted">New guest? <Link to="/signup">Create an account</Link>. Staff accounts are created by the admin.</p>
    </section>
  );
}
