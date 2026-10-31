// Screen 4 - Front desk check-in.
// 1) list CONFIRMED bookings  2) pick one -> GET /rooms/free for its type + dates
// 3) pick a room -> POST /bookings/:id/check-in
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Booking, FreeRoom } from '../api';
import { Loading, Message } from '../components';
import { errorText } from '../format';

export default function CheckInPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [rooms, setRooms] = useState<FreeRoom[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function loadBookings() {
    api.listBookings('CONFIRMED').then(setBookings).catch((e) => setError(errorText(e)));
  }
  useEffect(loadBookings, []);

  async function choose(b: Booking) {
    setSelected(b); setRooms(null); setRoomId(''); setError(''); setInfo('');
    try {
      setRooms(await api.freeRooms(b.room_type_id, b.check_in, b.check_out));
    } catch (e) { setError(errorText(e)); }
  }

  async function checkIn() {
    if (!selected || !roomId) return;
    setError('');
    try {
      await api.checkIn(selected.id, Number(roomId));
      const room = rooms?.find((r) => r.id === Number(roomId))?.room_number;
      setInfo(`Booking #${selected.id} checked in to room ${room}.`);
      setSelected(null); setRooms(null);
      loadBookings();                 // it's no longer CONFIRMED, so it leaves the list
    } catch (e) {
      // 409 = someone else just took that room, or the booking changed status.
      if (e instanceof ApiError && e.status === 409) {
        setError('Could not check in: ' + e.message + ' Pick another room.');
        choose(selected);            // reload the free rooms so the list is up to date
      } else setError(errorText(e));
    }
  }

  return (
    <section>
      <h1>Front desk: check-in</h1>
      <Message kind="success">{info}</Message>
      <Message kind="error">{error}</Message>
      {!bookings ? <Loading /> : bookings.length === 0 ? <p className="muted">No confirmed bookings waiting.</p> : (
        <table>
          <thead><tr><th>#</th><th>Guest</th><th>Room type</th><th>Dates</th><th></th></tr></thead>
          <tbody>{bookings.map((b) => (
            <tr key={b.id} className={selected?.id === b.id ? 'selected' : ''}>
              <td>#{b.id}</td><td>{b.guest_name}</td><td>{b.room_type}</td>
              <td>{b.check_in} → {b.check_out}</td>
              <td><button onClick={() => choose(b)}>Choose</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {selected && (
        <div className="card">
          <h2>Booking #{selected.id}: pick a room</h2>
          {!rooms ? <Loading /> : rooms.length === 0 ? <p className="sold">No free {selected.room_type} rooms for these dates.</p> : (
            <div className="row">
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">-- room --</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.room_number}</option>)}
              </select>
              <button disabled={!roomId} onClick={checkIn}>Check in</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
