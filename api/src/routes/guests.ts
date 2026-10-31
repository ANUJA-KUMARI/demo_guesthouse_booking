// guests.ts - create and look up guests.
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { toId } from '../validate.js';
import { staff } from '../auth.js';

// Staff only: front desk registers walk-in guests and looks them up.
// (Online guests get their guests row automatically at signup.)

export const guests = Router();

// POST /guests  { name, phone, email? }  -> 201 + the new guest
guests.post('/guests', staff, async (req, res) => {
  const { name, phone, email } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof phone !== 'string' || !phone.trim())
    throw new HttpError(400, 'name and phone are required');
  // $1, $2... keep values separate from the SQL text = no SQL injection.
  const r = await pool.query(
    'INSERT INTO guests(name, phone, email) VALUES ($1, $2, $3) RETURNING *',
    [name.trim(), phone.trim(), email ?? null]);
  res.status(201).json(r.rows[0]);
});

// GET /guests/:id -> the guest, or 404
guests.get('/guests/:id', staff, async (req, res) => {
  const r = await pool.query('SELECT * FROM guests WHERE id = $1', [toId(req.params.id, 'id')]);
  if (!r.rows[0]) throw new HttpError(404, 'Guest not found');
  res.json(r.rows[0]);
});
