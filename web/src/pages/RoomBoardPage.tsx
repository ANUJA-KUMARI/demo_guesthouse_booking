// Screen 5 - Room board / room change.
// Shows every CHECKED_IN booking with its current room, and lets the desk move
// a guest to another free room of the SAME type from a chosen date.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { BookingDetail, FreeRoom } from '../api';
import { Loading, Message } from '../components';
import { errorText, isoDate } from '../format';

export default function RoomBoardPage() {
  const [board, setBoard] = useState<BookingDetail[] | null>(null);
  const [moving, setMoving] = useState<BookingDetail | null>(null);
  const [onDate, setOnDate] = useState(isoDate(0));
  const [rooms, setRooms] = useState<FreeRoom[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function loadBoard() {
    try {
      const list = await api.listBookings('CHECKED_IN');
      // The list has no room numbers, so fetch each booking's details (in parallel).
      setBoard(await Promise.all(list.map((b) => api.booking(b.id))));
    } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { loadBoard(); }, []);

  // The current room = the stay that is still CONFIRMED (ended stays are history).
  const current = (b: BookingDetail) => b.stays.find((s) => s.status === 'CONFIRMED');

  // When the booking or date changes, reload rooms free from that date to checkout.
  useEffect(() => {
    if (!moving || onDate < moving.check_in || onDate >= moving.check_out) { setRooms(null); return; }
    api.freeRooms(moving.room_type_id, onDate, moving.check_out).then(setRooms).catch((e) => setError(errorText(e)));
  }, [moving, onDate]);

  function start(b: BookingDetail) {
    setMoving(b); setRoomId(''); setError(''); setInfo('');
    // Clamp the default date into the stay: the move must happen during it.
    const today = isoDate(0);
    setOnDate(today < b.check_in ? b.check_in : today >= b.check_out ? b.check_in : today);
  }

  async function change() {
    if (!moving || !roomId) return;
    setError('');
    try {
      await api.changeRoom(moving.id, Number(roomId), onDate);
      setInfo(`Booking #${moving.id} moved to room ${rooms?.find((r) => r.id === Number(roomId))?.room_number} from ${onDate}.`);
      setMoving(null);
      loadBoard();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        // The API ran it in ONE transaction: on failure, nothing changed.
        setError(`Room change refused (${e.message}). Nothing was changed - the guest is still in their old room.`);
      else if (e instanceof ApiError && e.status === 422) setError('Not allowed: ' + e.message);
      else setError(errorText(e));
    }
  }

  return (
    <section>
      <h1>Room board</h1>
      <Message kind="success">{info}</Message>
      <Message kind="error">{error}</Message>
      {!board ? <Loading /> : board.length === 0 ? <p className="muted">Nobody is checked in.</p> : (
        <table>
          <thead><tr><th>#</th><th>Current room</th><th>Dates</th><th></th></tr></thead>
          <tbody>{board.map((b) => (
            <tr key={b.id} className={moving?.id === b.id ? 'selected' : ''}>
              <td>#{b.id}</td><td>{current(b)?.room_number ?? '?'}</td>
              <td>{b.check_in} → {b.check_out}</td>
              <td><button onClick={() => start(b)}>Change room</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {moving && (
        <div className="card">
          <h2>Move booking #{moving.id} (now in room {current(moving)?.room_number})</h2>
          <div className="row">
            <label>From date
              <input type="date" value={onDate} min={moving.check_in}
                onChange={(e) => setOnDate(e.target.value)} />
            </label>
            {rooms && (
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">-- new room --</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.room_number}</option>)}
              </select>
            )}
            <button disabled={!roomId} onClick={change}>Change room</button>
          </div>
          <p className="muted">The date must be from {moving.check_in} up to the day before {moving.check_out}.</p>
          {rooms && rooms.length === 0 && <p className="sold">No other free rooms of this type from that date.</p>}
        </div>
      )}
    </section>
  );
}
