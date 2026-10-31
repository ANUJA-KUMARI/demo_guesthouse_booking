// Screen 3b - One booking: dates, status, room history (stays), event timeline,
// balance, and a Cancel button. Uses GET /bookings/:id and POST /bookings/:id/cancel.
// A guest also sees the bill lines here (read-only, GET /bookings/:id/folio);
// staff get a link to the Folio screen where they can add charges/payments.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { BookingDetail, Folio } from '../api';
import { useAuth } from '../auth';
import { Loading, Message, StatusBadge } from '../components';
import { errorText, rupees } from '../format';

export default function BookingDetailPage() {
  const id = Number(useParams().id);
  const isGuest = useAuth().user?.role === 'GUEST';
  const [b, setB] = useState<BookingDetail | null>(null);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // useCallback keeps the same function between renders, so useEffect doesn't loop.
  const load = useCallback(() => {
    api.booking(id).then(setB).catch((e) => setError(errorText(e)));
    api.folio(id).then(setFolio).catch(() => setFolio(null));
  }, [id]);
  useEffect(load, [load]);

  async function cancel() {
    if (!confirm(`Cancel booking #${id}?`)) return;   // ask first: cancelling can't be undone
    setError(''); setInfo('');
    try {
      await api.cancel(id);
      setInfo('Booking cancelled. Its nights are free again.');
      load();                                        // refresh to show the new status + event
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        setError('This booking can no longer be cancelled: ' + e.message);
      else setError(errorText(e));
    }
  }

  if (error && !b) return <Message kind="error">{error}</Message>;
  if (!b) return <Loading />;

  return (
    <section>
      <p><Link to="/bookings">← {isGuest ? 'My bookings' : 'All bookings'}</Link></p>
      <h1>Booking #{b.id} <StatusBadge status={b.status} /></h1>
      <div className="card">
        <p><b>Room type:</b> {b.room_type} &nbsp; {!isGuest && <><b>Guest:</b> {b.guest_name}</>}</p>
        <p><b>Dates:</b> {b.check_in} → {b.check_out}</p>
        <p><b>Balance due:</b> {rupees(b.balance_paise)} {!isGuest && <>&nbsp; <Link to={`/folio/${b.id}`}>Open folio</Link></>}</p>
        {b.status === 'CONFIRMED' && <button className="danger" onClick={cancel}>Cancel booking</button>}
      </div>
      <Message kind="error">{error}</Message>
      <Message kind="success">{info}</Message>

      <h2>Bill</h2>
      {!folio || folio.lines.length === 0 ? <p className="muted">No charges yet.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="num">Amount</th></tr></thead>
          <tbody>{folio.lines.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.created_at).toLocaleDateString('en-IN')}</td><td>{l.kind}</td><td>{l.description}</td>
              <td className="num">{rupees(l.amount_paise)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th colSpan={3}>Balance due</th><th className="num">{rupees(folio.balance_paise)}</th></tr></tfoot>
        </table>
      )}

      <h2>Rooms (stays)</h2>
      {b.stays.length === 0 ? <p className="muted">Not checked in yet.</p> : (
        <table>
          <thead><tr><th>Room</th><th>From</th><th>To</th><th>Status</th></tr></thead>
          <tbody>{b.stays.map((s) => (
            <tr key={s.id}><td>{s.room_number}</td><td>{s.from_date}</td><td>{s.to_date}</td><td>{s.status}</td></tr>
          ))}</tbody>
        </table>
      )}

      <h2>History</h2>
      {/* booking_events is append-only, so this is a true record of what happened. */}
      <ul className="timeline">
        {b.events.map((ev) => (
          <li key={ev.id}>
            <b>{ev.event_type}</b> <span className="muted">{new Date(ev.created_at).toLocaleString('en-IN')}</span>
            {ev.details != null && <code>{JSON.stringify(ev.details)}</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}
