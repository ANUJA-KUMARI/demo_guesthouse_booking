// Admin screen - list staff accounts and create new MANAGERS.
// Only an ADMIN can open this (RequireRole in App.tsx), and only an ADMIN
// can call POST /admin/users (the API checks again - the real lock).
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../api';
import type { StaffUser } from '../api';
import { Loading, Message } from '../components';
import { errorText } from '../format';

export default function AdminPage() {
  const [staff, setStaff] = useState<StaffUser[] | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.staff().then(setStaff).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const set = (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      const m = await api.createManager(form);
      setInfo(`Manager ${m.email} created. Give them their password privately; they can log in now.`);
      setForm({ full_name: '', email: '', password: '' });
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Managers</h1>
      <h2>Create a manager</h2>
      <form className="card form" onSubmit={create}>
        <label>Full name <input name="full_name" value={form.full_name} onChange={set} required /></label>
        <label>Email <input name="email" type="email" value={form.email} onChange={set} required /></label>
        <label>Temporary password (8+ characters)
          <input name="password" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set} required />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create manager'}</button>
      </form>
      <Message kind="error">{error}</Message>
      <Message kind="success">{info}</Message>

      <h2>Staff accounts</h2>
      {!staff ? <Loading /> : (
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Created</th></tr></thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td><td>{u.full_name}</td><td>{u.email}</td>
                <td><span className={`badge badge-role-${u.role}`}>{u.role}</span></td>
                <td>{new Date(u.created_at).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
