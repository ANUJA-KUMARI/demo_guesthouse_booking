// Screen 3a - Bookings list with a status filter (GET /bookings?status=...).
// Same screen for both: the API returns ALL bookings to staff, and only
// the guest's OWN bookings to a guest ("My bookings").
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Booking, BookingStatus } from '../api';
import { Loading, Message, StatusBadge } from '../components';
import { errorText } from '../format';
import { useAuth } from '../auth';

const STATUSES: BookingStatus[] = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];

export default function BookingsPage() {
  const isGuest = useAuth().user?.role === 'GUEST';
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');

  // Re-load whenever the filter changes ([status] = the "dependency").
  useEffect(() => {
    // "ignore" stops an old, slow response overwriting a newer one.
    let ignore = false;
    setRows(null); setError('');
    api.listBookings(status || undefined)
      .then((r) => { if (!ignore) setRows(r); })
      .catch((e) => { if (!ignore) setError(errorText(e)); });
    return () => { ignore = true; };
  }, [status]);

  return (
    <section>
      <h1>{isGuest ? 'My bookings' : 'All bookings'}</h1>
      <label className="row">Status
        <select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')}>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <Message kind="error">{error}</Message>
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="muted">No bookings{isGuest && <>. <Link to="/search">Find a room</Link></>}.</p>}
      {rows && rows.length > 0 && (
        <table>
          <thead><tr><th>#</th>{!isGuest && <th>Guest</th>}<th>Room type</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/bookings/${b.id}`}>#{b.id}</Link></td>
                {!isGuest && <td>{b.guest_name}</td>}<td>{b.room_type}</td>
                <td>{b.check_in}</td><td>{b.check_out}</td>
                <td><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
