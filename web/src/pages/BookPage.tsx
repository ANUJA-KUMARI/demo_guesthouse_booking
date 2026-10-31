// Screen 2 - Booking form. Two versions in one screen:
//  - GUEST: just room type + dates. The API books it in THEIR name (from the login).
//  - STAFF (walk-in): also guest name/phone -> POST /guests, then POST /bookings.
// The DATABASE decides if a room is left - we just show its answer kindly.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { RoomType } from '../api';
import { Message } from '../components';
import { useAuth } from '../auth';
import { errorText, isoDate, rupees } from '../format';

export default function BookPage() {
  const { user } = useAuth();
  const isGuest = user?.role === 'GUEST';
  // useSearchParams reads ?room_type_id=..&check_in=.. sent by the Availability screen.
  const [params] = useSearchParams();
  const [types, setTypes] = useState<RoomType[]>([]);
  const [roomTypeId, setRoomTypeId] = useState(params.get('room_type_id') ?? '');
  const [checkIn, setCheckIn] = useState(params.get('check_in') ?? isoDate(0));
  const [checkOut, setCheckOut] = useState(params.get('check_out') ?? isoDate(1));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookingId, setBookingId] = useState<number | null>(null);

  // Load the room types once, for the dropdown. [] = run only on first render.
  useEffect(() => {
    api.roomTypes().then(setTypes).catch((e) => setError(errorText(e)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setBookingId(null); setBusy(true);   // busy disables the button = no double clicks
    try {
      // Staff create the walk-in guest first; a logged-in guest already IS a guest.
      const guestId = isGuest ? undefined : (await api.createGuest({ name, phone, email: email || undefined })).id;
      const b = await api.createBooking({
        guest_id: guestId, room_type_id: Number(roomTypeId), check_in: checkIn, check_out: checkOut,
      });
      setBookingId(b.id);
    } catch (err) {
      // Turn status codes into words a receptionist understands.
      if (err instanceof ApiError && err.status === 409)
        setError('Sorry, this room type is sold out for those dates. Try other dates or another room type.');
      else if (err instanceof ApiError && err.status === 400)
        setError('Please check the form: ' + err.message);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>{isGuest ? 'Book a room' : 'Walk-in booking'}</h1>
      {isGuest && <p className="muted">Booking as <b>{user?.full_name}</b>. Pay at the front desk; your bill appears under My bookings.</p>}
      <form className="card form" onSubmit={submit}>
        <label>Room type
          <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} required>
            <option value="">-- choose --</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({rupees(t.rate_paise)}/night)</option>)}
          </select>
        </label>
        <div className="row">
          <label>Check-in <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required /></label>
          <label>Check-out <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} required /></label>
        </div>
        {!isGuest && (   // only the front desk types in someone else's details
          <>
            <label>Guest name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Phone <input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
            <label>Email (optional) <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </>
        )}
        <button type="submit" disabled={busy}>{busy ? 'Booking…' : 'Book'}</button>
      </form>
      <Message kind="error">{error}</Message>
      {bookingId !== null && (
        <Message kind="success">
          Booked! Booking id <b>#{bookingId}</b>. <Link to={`/bookings/${bookingId}`}>View booking</Link>
        </Message>
      )}
    </section>
  );
}
