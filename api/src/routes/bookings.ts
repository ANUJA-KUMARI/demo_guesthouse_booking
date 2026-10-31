// bookings.ts - create, list, view and cancel bookings.
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { toId, toStay } from '../validate.js';
import { assertOwnBooking, isStaff, loggedIn } from '../auth.js';

export const bookings = Router();

// lower()/upper() turn the daterange into plain check_in / check_out dates,
// which is easier for the React screens than '[2026-12-01,2026-12-03)'.
// to_char keeps them as 'YYYY-MM-DD' text (no timezone shifting in JSON).
const COLS = `b.id, b.guest_id, b.room_type_id, b.status, b.created_at,
  to_char(lower(b.during),'YYYY-MM-DD') AS check_in,
  to_char(upper(b.during),'YYYY-MM-DD') AS check_out`;

// WHO MAY DO WHAT (see AUTH_README.md):
//  - a GUEST only ever works on their OWN bookings (users.guest_id),
//  - a MANAGER/ADMIN works on everyone's (front desk, walk-in guests).

// POST /bookings { guest_id, room_type_id, check_in, check_out } -> 201, or 409 when full.
// A GUEST's guest_id is taken from their login, NOT from the body, so they
// can't book in someone else's name. Staff choose the guest (walk-ins).
// The API does NOT count rooms itself: the type_nights trigger + CHECK does,
// with row locks, so 50 simultaneous requests can't overbook.
bookings.post('/bookings', loggedIn, async (req, res) => {
  const { guest_id, room_type_id, check_in, check_out } = req.body ?? {};
  const user = req.user!;
  const g = isStaff(user) ? toId(guest_id, 'guest_id') : user.guest_id!;
  const t = toId(room_type_id, 'room_type_id');
  const [ci, co] = toStay(check_in, check_out);
  const r = await pool.query(
    `INSERT INTO bookings (guest_id, room_type_id, during)
     VALUES ($1, $2, daterange($3::date, $4::date, '[)'))
     RETURNING id, guest_id, room_type_id, during, status`,
    [g, t, ci, co]);
  res.status(201).json(r.rows[0]);
  // errors: 23514 -> 409 full, 23503 -> 404 unknown guest/type (see errors.ts)
});

// GET /bookings?status=CONFIRMED  (status is optional)
// Staff see all bookings; a guest sees only their own ("My bookings").
bookings.get('/bookings', loggedIn, async (req, res) => {
  const user = req.user!;
  const onlyGuest = isStaff(user) ? null : user.guest_id;
  const status = req.query.status;
  const allowed = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
  if (status !== undefined && !allowed.includes(String(status)))
    throw new HttpError(400, `status must be one of ${allowed.join(', ')}`);
  // ($1::text IS NULL OR ...) = "filter only if a status was given"
  const r = await pool.query(
    `SELECT ${COLS}, g.name AS guest_name, rt.name AS room_type
       FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN room_types rt ON rt.id = b.room_type_id
      WHERE ($1::text IS NULL OR b.status = $1)
        AND ($2::int  IS NULL OR b.guest_id = $2)        -- guests: own rows only
      ORDER BY lower(b.during), b.id`, [status ?? null, onlyGuest]);
  res.json(r.rows);
});

// GET /bookings/:id -> booking + its stays (rooms) + history events + balance
bookings.get('/bookings/:id', loggedIn, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const b = await pool.query(
    `SELECT ${COLS}, g.name AS guest_name, rt.name AS room_type
       FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN room_types rt ON rt.id = b.room_type_id
      WHERE b.id = $1`, [id]);
  if (!b.rows[0]) throw new HttpError(404, 'Booking not found');
  assertOwnBooking(req.user!, b.rows[0].guest_id);   // another guest's booking -> 404
  // Run the 3 independent reads at the same time.
  const [stays, events, bal] = await Promise.all([
    pool.query(`SELECT s.id, s.room_id, r.room_number, s.status,
                       to_char(lower(s.during),'YYYY-MM-DD') AS from_date,
                       to_char(upper(s.during),'YYYY-MM-DD') AS to_date
                  FROM stays s JOIN rooms r ON r.id = s.room_id
                 WHERE s.booking_id = $1 ORDER BY s.id`, [id]),
    pool.query('SELECT id, event_type, details, created_at FROM booking_events WHERE booking_id = $1 ORDER BY id', [id]),
    pool.query('SELECT balance_paise FROM booking_balances WHERE booking_id = $1', [id]),
  ]);
  res.json({ ...b.rows[0], stays: stays.rows, events: events.rows,
             balance_paise: bal.rows[0]?.balance_paise ?? 0 });
});

// POST /bookings/:id/cancel -> 200, 404 if unknown, 409 if not CONFIRMED.
// One UPDATE is already atomic, so no transaction helper needed. The
// "AND status = 'CONFIRMED'" makes it safe even if two clerks click at once:
// only one UPDATE matches. The capacity trigger gives the nights back and the
// event trigger logs CANCELLED automatically.
// A guest may cancel only their own booking: we check ownership FIRST.
bookings.post('/bookings/:id/cancel', loggedIn, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const own = await pool.query('SELECT guest_id FROM bookings WHERE id = $1', [id]);
  if (!own.rows[0]) throw new HttpError(404, 'Booking not found');
  assertOwnBooking(req.user!, own.rows[0].guest_id);
  const r = await pool.query(
    `UPDATE bookings SET status = 'CANCELLED' WHERE id = $1 AND status = 'CONFIRMED'
     RETURNING id, status`, [id]);
  if (r.rows[0]) return res.json(r.rows[0]);
  const ex = await pool.query('SELECT status FROM bookings WHERE id = $1', [id]);
  if (!ex.rows[0]) throw new HttpError(404, 'Booking not found');
  throw new HttpError(409, `Booking is ${ex.rows[0].status}; only CONFIRMED bookings can be cancelled`);
});
