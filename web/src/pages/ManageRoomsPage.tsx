// Manager screen - add, edit and delete ROOM TYPES and ROOMS.
//
// Delete is allowed only for things nothing points to. If a booking, stay or
// room still uses it, the DATABASE refuses (foreign key) and the API answers
// 409 with a clear message, which we show. History can never lose its room.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import type { Room, RoomType } from '../api';
import { Loading, Message } from '../components';
import { errorText, rupees, toPaise } from '../format';

// Form values are kept as TEXT (that's what inputs give us) and converted on save.
const emptyType = { name: '', capacity: '', rate: '' };
const emptyRoom = { room_number: '', room_type_id: '' };

export default function ManageRoomsPage() {
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  // editTypeId = null -> the form ADDS; a number -> the form EDITS that row.
  const [typeForm, setTypeForm] = useState(emptyType);
  const [editTypeId, setEditTypeId] = useState<number | null>(null);
  const [roomForm, setRoomForm] = useState(emptyRoom);
  const [editRoomId, setEditRoomId] = useState<number | null>(null);

  const load = useCallback(() => {
    Promise.all([api.roomTypes(), api.rooms()])
      .then(([t, r]) => { setTypes(t); setRooms(r); })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  // Runs an action, shows success or the API's error, then reloads the lists.
  async function run(action: () => Promise<unknown>, done: string) {
    setError(''); setInfo('');
    try {
      await action();
      setInfo(done);
      load();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function saveType(e: FormEvent) {
    e.preventDefault();
    const rate_paise = typeForm.rate.trim() === '0' ? 0 : toPaise(typeForm.rate);
    if (rate_paise === null) return setError('Rate must be a number of rupees, e.g. 2500');
    const body = { name: typeForm.name, capacity: Number(typeForm.capacity), rate_paise };
    const ok = await run(
      () => (editTypeId ? api.updateRoomType(editTypeId, body) : api.createRoomType(body)),
      editTypeId ? 'Room type updated.' : 'Room type added.');
    if (ok) { setTypeForm(emptyType); setEditTypeId(null); }
  }

  async function saveRoom(e: FormEvent) {
    e.preventDefault();
    const body = { room_number: roomForm.room_number, room_type_id: Number(roomForm.room_type_id) };
    const ok = await run(
      () => (editRoomId ? api.updateRoom(editRoomId, body) : api.createRoom(body)),
      editRoomId ? 'Room updated.' : 'Room added.');
    if (ok) { setRoomForm(emptyRoom); setEditRoomId(null); }
  }

  if (!types || !rooms) return error ? <Message kind="error">{error}</Message> : <Loading />;

  return (
    <section>
      <h1>Rooms &amp; room types</h1>
      <Message kind="error">{error}</Message>
      <Message kind="success">{info}</Message>

      <h2>Room types</h2>
      <p className="muted">Capacity = how many of this type can be booked per night. Keep it ≤ the number of rooms.</p>
      <table>
        <thead><tr><th>Name</th><th>Capacity</th><th>Rooms</th><th>Rate / night</th><th></th></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className={editTypeId === t.id ? 'selected' : ''}>
              <td>{t.name}</td><td>{t.capacity}</td><td>{t.rooms}</td><td>{rupees(t.rate_paise)}</td>
              <td className="actions">
                <button className="small" onClick={() => { setEditTypeId(t.id);
                  setTypeForm({ name: t.name, capacity: String(t.capacity), rate: String(t.rate_paise / 100) }); }}>Edit</button>
                <button className="small danger" onClick={() => confirm(`Delete room type "${t.name}"?`)
                  && run(() => api.deleteRoomType(t.id), 'Room type deleted.')}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card row" onSubmit={saveType}>
        <b>{editTypeId ? `Edit room type #${editTypeId}` : 'Add room type'}</b>
        <label>Name <input value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} required /></label>
        <label>Capacity <input type="number" min={1} value={typeForm.capacity} onChange={(e) => setTypeForm({ ...typeForm, capacity: e.target.value })} required /></label>
        <label>Rate ₹/night <input type="number" min={0} step="0.01" value={typeForm.rate} onChange={(e) => setTypeForm({ ...typeForm, rate: e.target.value })} required /></label>
        <button type="submit">{editTypeId ? 'Save' : 'Add'}</button>
        {editTypeId && <button type="button" className="secondary" onClick={() => { setEditTypeId(null); setTypeForm(emptyType); }}>Cancel</button>}
      </form>

      <h2>Rooms</h2>
      <table>
        <thead><tr><th>Room number</th><th>Type</th><th></th></tr></thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id} className={editRoomId === r.id ? 'selected' : ''}>
              <td>{r.room_number}</td><td>{r.room_type}</td>
              <td className="actions">
                <button className="small" onClick={() => { setEditRoomId(r.id);
                  setRoomForm({ room_number: r.room_number, room_type_id: String(r.room_type_id) }); }}>Edit</button>
                <button className="small danger" onClick={() => confirm(`Delete room ${r.room_number}?`)
                  && run(() => api.deleteRoom(r.id), 'Room deleted.')}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card row" onSubmit={saveRoom}>
        <b>{editRoomId ? `Edit room #${editRoomId}` : 'Add room'}</b>
        <label>Room number <input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} required /></label>
        <label>Type
          <select value={roomForm.room_type_id} onChange={(e) => setRoomForm({ ...roomForm, room_type_id: e.target.value })} required>
            <option value="">-- choose --</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button type="submit">{editRoomId ? 'Save' : 'Add'}</button>
        {editRoomId && <button type="button" className="secondary" onClick={() => { setEditRoomId(null); setRoomForm(emptyRoom); }}>Cancel</button>}
      </form>
    </section>
  );
}
