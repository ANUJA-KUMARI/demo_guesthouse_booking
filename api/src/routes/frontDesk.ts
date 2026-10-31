// frontDesk.ts - check-in, free rooms, room change, check-out.
//
// The real work is in the database functions from 007 (check_in, change_room,
// check_out). We call them inside withTransaction so that all their row
// changes PLUS anything we add later (e.g. a first-night charge) are one
// all-or-nothing unit. If the function raises an error, ROLLBACK undoes
// everything and errors.ts turns the error into 409/422/404.
import { Router } from 'express';
import { pool } from '../db.js';
import { withTransaction } from '../tx.js';
import { toDate, toId, toStay } from '../validate.js';
import { staff } from '../auth.js';

// Every route here is front-desk work: MANAGER or ADMIN only (`staff`).

export const frontDesk = Router();

// POST /bookings/:id/check-in { room_id } -> 200 { stay_id }
frontDesk.post('/bookings/:id/check-in', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const room = toId(req.body?.room_id, 'room_id');
  const stayId = await withTransaction(async (c) => {
    const r = await c.query('SELECT check_in($1, $2) AS stay_id', [id, room]);
    return r.rows[0].stay_id as number;
  });
  res.json({ booking_id: id, stay_id: stayId, status: 'CHECKED_IN' });
});

// GET /rooms/free?room_type_id=1&check_in=...&check_out=...
// Rooms of that type with NO active (CONFIRMED) stay overlapping (&&) the dates.
// Same rule the EXCLUDE constraint enforces, so the list matches what check-in accepts.
frontDesk.get('/rooms/free', staff, async (req, res) => {
  const type = toId(req.query.room_type_id, 'room_type_id');
  const [ci, co] = toStay(req.query.check_in, req.query.check_out);
  const r = await pool.query(`
    SELECT r.id, r.room_number, r.room_type_id
      FROM rooms r
     WHERE r.room_type_id = $1
       AND NOT EXISTS (SELECT 1 FROM stays s
                        WHERE s.room_id = r.id AND s.status = 'CONFIRMED'
                          AND s.during && daterange($2::date, $3::date, '[)'))
     ORDER BY r.room_number`, [type, ci, co]);
  res.json(r.rows);
});

// POST /bookings/:id/change-room { new_room_id, on_date? } -> 200 { stay_id }
// on_date omitted -> the database default (today).
frontDesk.post('/bookings/:id/change-room', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const room = toId(req.body?.new_room_id, 'new_room_id');
  const onDate = req.body?.on_date === undefined ? null : toDate(req.body.on_date, 'on_date');
  const stayId = await withTransaction(async (c) => {
    const r = onDate
      ? await c.query('SELECT change_room($1, $2, $3::date) AS stay_id', [id, room, onDate])
      : await c.query('SELECT change_room($1, $2) AS stay_id', [id, room]);
    return r.rows[0].stay_id as number;
  });
  // If the new room was taken (23P01 -> 409), ROLLBACK also undid ending the
  // old stay, so the guest is still safely in their original room.
  res.json({ booking_id: id, stay_id: stayId });
});

// POST /bookings/:id/check-out -> 200, or 422 if the bill isn't settled.
frontDesk.post('/bookings/:id/check-out', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  await withTransaction((c) => c.query('SELECT check_out($1)', [id]));
  res.json({ booking_id: id, status: 'CHECKED_OUT' });
});
