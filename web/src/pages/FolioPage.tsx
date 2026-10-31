// Screen 6 - Folio (the bill) & checkout.
// GET /bookings/:id/folio shows lines + balance, POST adds a line,
// POST /bookings/:id/check-out ends the stay (422 if the balance isn't zero).
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Booking, Folio, FolioKind } from '../api';
import { Loading, Message } from '../components';
import { errorText, rupees, toPaise } from '../format';

const KINDS: FolioKind[] = ['CHARGE', 'PAYMENT', 'CREDIT', 'REFUND'];

export default function FolioPage() {
  const idParam = useParams().id;
  const id = idParam ? Number(idParam) : null;
  const navigate = useNavigate();
  const [checkedIn, setCheckedIn] = useState<Booking[]>([]);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [kind, setKind] = useState<FolioKind>('CHARGE');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Booking picker: guests who are in the house right now.
  useEffect(() => {
    api.listBookings('CHECKED_IN').then(setCheckedIn).catch((e) => setError(errorText(e)));
  }, []);

  const load = useCallback(() => {
    if (id === null) return;
    setFolio(null);
    api.folio(id).then(setFolio).catch((e) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  async function addLine(e: FormEvent) {
    e.preventDefault();
    if (id === null) return;
    const paise = toPaise(amount);     // rupees typed -> whole paise for the API
    if (paise === null) { setError('Enter an amount in rupees greater than 0, e.g. 2500 or 2500.50'); return; }
    setError(''); setInfo('');
    try {
      await api.addFolioLine(id, { kind, amount_paise: paise, description: desc });
      setAmount(''); setDesc('');
      load();
    } catch (err) { setError(errorText(err)); }
  }

  async function checkOut() {
    if (id === null) return;
    setError(''); setInfo('');
    try {
      await api.checkOut(id);
      setInfo(`Booking #${id} checked out. Room is free again.`);
      setCheckedIn((list) => list.filter((b) => b.id !== id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 422)
        setError(`Can't check out yet: the balance must be ₹0.00 (it is ${folio ? rupees(folio.balance_paise) : '?'}). Add a PAYMENT or CREDIT first.`);
      else if (e instanceof ApiError && e.status === 409) setError('Not checked in: ' + e.message);
      else setError(errorText(e));
    }
  }

  return (
    <section>
      <h1>Folio & checkout</h1>
      <label className="row">Booking
        <select value={id ?? ''} onChange={(e) => navigate(e.target.value ? `/folio/${e.target.value}` : '/folio')}>
          <option value="">-- choose a checked-in booking --</option>
          {checkedIn.map((b) => <option key={b.id} value={b.id}>#{b.id} {b.guest_name} ({b.room_type})</option>)}
          {/* Keep the current id selectable even if it's not checked in (e.g. opened from details). */}
          {id !== null && !checkedIn.some((b) => b.id === id) && <option value={id}>#{id}</option>}
        </select>
      </label>
      <Message kind="error">{error}</Message>
      <Message kind="success">{info}</Message>
      {id !== null && !folio && !error && <Loading />}
      {folio && (
        <>
          <table>
            <thead><tr><th>#</th><th>Kind</th><th>Description</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {folio.lines.length === 0 && <tr><td colSpan={4} className="muted">No lines yet.</td></tr>}
              {folio.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.id}</td><td>{l.kind}</td><td>{l.description}</td>
                  {/* CHARGE and REFUND increase what the guest owes; PAYMENT and CREDIT reduce it. */}
                  <td className="num">{l.kind === 'PAYMENT' || l.kind === 'CREDIT' ? '−' : ''}{rupees(l.amount_paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={3}>Balance due</th><th className="num">{rupees(folio.balance_paise)}</th></tr></tfoot>
          </table>
          <form className="row card" onSubmit={addLine}>
            <select value={kind} onChange={(e) => setKind(e.target.value as FolioKind)}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <input placeholder="Amount in ₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button type="submit">Add line</button>
          </form>
          <p className="muted">Lines can't be edited or deleted. To fix a mistake, add a CREDIT or REFUND.</p>
          <button onClick={checkOut}>Check out</button>
        </>
      )}
    </section>
  );
}
