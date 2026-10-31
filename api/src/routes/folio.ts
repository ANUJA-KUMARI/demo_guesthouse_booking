// folio.ts - the guest's bill.
// Lines can only be ADDED (append-only, enforced in 005/006). To fix a mistake,
// add a CREDIT or REFUND line - which is why there is no PUT or DELETE here.
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { toId } from '../validate.js';
import { assertOwnBooking, loggedIn, staff } from '../auth.js';

export const folio = Router();
const KINDS = ['CHARGE', 'PAYMENT', 'CREDIT', 'REFUND'];

// GET /bookings/:id/folio -> { lines, balance_paise }
// balance comes from the booking_balances view (always recalculated, never stale).
// A guest can read the bill of their OWN booking; staff can read any.
folio.get('/bookings/:id/folio', loggedIn, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const bal = await pool.query(
    `SELECT bb.balance_paise, b.guest_id FROM booking_balances bb
       JOIN bookings b ON b.id = bb.booking_id WHERE bb.booking_id = $1`, [id]);
  if (!bal.rows[0]) throw new HttpError(404, 'Booking not found');
  assertOwnBooking(req.user!, bal.rows[0].guest_id);
  const lines = await pool.query(
    'SELECT id, kind, amount_paise, description, created_at FROM folio_lines WHERE booking_id = $1 ORDER BY id', [id]);
  res.json({ booking_id: id, lines: lines.rows, balance_paise: bal.rows[0].balance_paise });
});

// POST /bookings/:id/folio { kind, amount_paise, description? } -> 201 + the new line
// Only staff add charges/payments (a guest can't pay themselves on paper!).
folio.post('/bookings/:id/folio', staff, async (req, res) => {
  const id = toId(req.params.id, 'id');
  const { kind, amount_paise, description } = req.body ?? {};
  if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  // Paise are whole numbers: Rs 2500.50 = 250050 paise. No decimals = no rounding errors.
  if (!Number.isInteger(amount_paise) || amount_paise <= 0)
    throw new HttpError(400, 'amount_paise must be a positive whole number (paise)');
  const r = await pool.query(
    `INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, kind, amount_paise, typeof description === 'string' ? description : '']);
  res.status(201).json(r.rows[0]);   // unknown booking -> 23503 -> 404
});
