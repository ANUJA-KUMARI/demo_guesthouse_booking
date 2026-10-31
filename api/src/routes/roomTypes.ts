// roomTypes.ts - room types and physical rooms.
//  - Anyone may LIST room types (the search page needs them, even before login).
//  - Only MANAGER/ADMIN may add, edit or delete room types and rooms.
//  - Delete is refused (409) if something still uses the row (a booking,
//    a stay, rooms of that type...). The FOREIGN KEYS in the database decide
//    that, so history can never point at a deleted room.
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { toId } from '../validate.js';
import { staff } from '../auth.js';

export const roomTypes = Router();

// Turn "still in use" foreign-key errors into a clear 409 for delete/update.
function inUse(e: any, what: string): never {
  if (e?.code === '23503') throw new HttpError(409, `This ${what} is still in use (bookings, stays or rooms point to it), so it can't be deleted`);
  throw e;
}

function typeBody(b: any) {
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name) throw new HttpError(400, 'name is required');
  const capacity = Number(b?.capacity), rate = Number(b?.rate_paise);
  if (!Number.isInteger(capacity) || capacity <= 0) throw new HttpError(400, 'capacity must be a whole number above 0');
  if (!Number.isInteger(rate) || rate < 0) throw new HttpError(400, 'rate_paise must be a whole number (paise), 0 or more');
  return [name, capacity, rate] as const;
}

// GET /room-types -> [{ id, name, capacity, rate_paise, rooms }]   (public)
// "rooms" = how many physical rooms exist, handy to compare with capacity.
roomTypes.get('/room-types', async (_req, res) => {
  const r = await pool.query(`
    SELECT rt.*, (SELECT count(*)::int FROM rooms WHERE room_type_id = rt.id) AS rooms
      FROM room_types rt ORDER BY rt.id`);
  res.json(r.rows);
});

// POST /room-types { name, capacity, rate_paise } -> 201
roomTypes.post('/room-types', staff, async (req, res) => {
  const [name, capacity, rate] = typeBody(req.body);
  const r = await pool.query(
    'INSERT INTO room_types(name, capacity, rate_paise) VALUES ($1, $2, $3) RETURNING *', [name, capacity, rate]);
  res.status(201).json(r.rows[0]);          // same name twice -> 23505 -> 409
});

// PUT /room-types/:id { name, capacity, rate_paise }
// Lowering capacity below what's already booked on some future night fails
// the CHECK (booked <= capacity) in type_nights (trigger from 010) -> 409.
roomTypes.put('/room-types/:id', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const [name, capacity, rate] = typeBody(req.body);
  try {
    const r = await pool.query(
      'UPDATE room_types SET name = $2, capacity = $3, rate_paise = $4 WHERE id = $1 RETURNING *',
      [id, name, capacity, rate]);
    if (!r.rows[0]) throw new HttpError(404, 'Room type not found');
    res.json(r.rows[0]);
  } catch (e: any) {
    if (e?.code === '23514') throw new HttpError(409, 'Capacity is lower than rooms already booked on some future night');
    throw e;
  }
});

// DELETE /room-types/:id -> 204, 404, or 409 if in use
roomTypes.delete('/room-types/:id', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const r = await pool.query('DELETE FROM room_types WHERE id = $1', [id]).catch((e) => inUse(e, 'room type'));
  if (r.rowCount === 0) throw new HttpError(404, 'Room type not found');
  res.status(204).end();
});

// ---------------- physical rooms ----------------

// GET /rooms -> every room with its type name (staff)
roomTypes.get('/rooms', staff, async (_req, res) => {
  const r = await pool.query(`
    SELECT r.id, r.room_number, r.room_type_id, rt.name AS room_type
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
     ORDER BY r.room_number`);
  res.json(r.rows);
});

function roomBody(b: any) {
  const num = typeof b?.room_number === 'string' ? b.room_number.trim() : '';
  if (!num) throw new HttpError(400, 'room_number is required');
  return [num, toId(b?.room_type_id, 'room_type_id')] as const;
}

// POST /rooms { room_number, room_type_id } -> 201
roomTypes.post('/rooms', staff, async (req, res) => {
  const [num, type] = roomBody(req.body);
  const r = await pool.query(
    'INSERT INTO rooms(room_number, room_type_id) VALUES ($1, $2) RETURNING *', [num, type]);
  res.status(201).json(r.rows[0]);          // duplicate number -> 409, unknown type -> 404
});

// PUT /rooms/:id { room_number, room_type_id }
roomTypes.put('/rooms/:id', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const [num, type] = roomBody(req.body);
  // Changing the TYPE of a room someone is sleeping in would break "a stay is
  // always in a room of the booked type", so refuse while it has an active stay.
  const busy = await pool.query(
    `SELECT 1 FROM stays s JOIN rooms r ON r.id = s.room_id
      WHERE s.room_id = $1 AND s.status = 'CONFIRMED' AND r.room_type_id <> $2`, [id, type]);
  if (busy.rows[0]) throw new HttpError(409, 'A guest is staying in this room; change its type after they leave');
  const r = await pool.query(
    'UPDATE rooms SET room_number = $2, room_type_id = $3 WHERE id = $1 RETURNING *', [id, num, type]);
  if (!r.rows[0]) throw new HttpError(404, 'Room not found');
  res.json(r.rows[0]);
});

// DELETE /rooms/:id -> 204, 404, or 409 if it has stays (history)
roomTypes.delete('/rooms/:id', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const r = await pool.query('DELETE FROM rooms WHERE id = $1', [id]).catch((e) => inUse(e, 'room'));
  if (r.rowCount === 0) throw new HttpError(404, 'Room not found');
  res.status(204).end();
});
