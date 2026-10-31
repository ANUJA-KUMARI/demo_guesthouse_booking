// Signup screen - ONLY for guests. There is no "role" field on purpose:
// the API always creates a GUEST, whatever the browser sends.
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { homeFor, useAuth } from '../auth';
import { Message } from '../components';
import { errorText } from '../format';

export default function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  // One change handler for all inputs: the input's "name" says which field.
  const set = (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('The two passwords are different.');
    setBusy(true);
    try {
      const { confirm: _c, ...data } = form;      // don't send "confirm" to the API
      await signup(data);
      navigate('/search', { replace: true });     // signed up = logged in as a guest
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 400)) setError(err.message);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-box">
      <h1>Create a guest account</h1>
      <form className="card form" onSubmit={submit}>
        <label>Full name <input name="full_name" value={form.full_name} onChange={set} required /></label>
        <label>Phone <input name="phone" type="tel" value={form.phone} onChange={set} required /></label>
        <label>Email <input name="email" type="email" autoComplete="email" value={form.email} onChange={set} required /></label>
        <label>Password (8+ characters)
          <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.password} onChange={set} required />
        </label>
        <label>Confirm password <input name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set} required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
      <Message kind="error">{error}</Message>
      <p className="muted">Already have an account? <Link to="/login">Log in</Link></p>
    </section>
  );
}
