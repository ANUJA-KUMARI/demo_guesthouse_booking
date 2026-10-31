// availability.ts - "how many rooms of each type are free for these dates?"
//
// WHY use type_nights? It already holds "booked" per type per night, kept
// exact by the trigger. A stay is only possible if EVERY night has space, so
// the busiest night decides: free = capacity - (max booked over those nights).
// Nights with no row yet mean nobody booked them (booked = 0).
//
// NOTE: this is for DISPLAY only. Between showing "1 free" and the guest
// clicking Book, someone else may take it - POST /bookings is still the
// real, safe check (the database refuses with 409).
import { Router } from 'express';
import { pool } from '../db.js';
import { toStay } from '../validate.js';

export const availability = Router();

// GET /availability?check_in=2026-12-01&check_out=2026-12-03
availability.get('/availability', async (req, res) => {
  const [ci, co] = toStay(req.query.check_in, req.query.check_out);
  const r = await pool.query(`
    SELECT rt.id AS room_type_id, rt.name, rt.capacity, rt.rate_paise,
           COALESCE(MAX(tn.booked), 0)::int               AS max_booked,
           (rt.capacity - COALESCE(MAX(tn.booked), 0))::int AS free
      FROM room_types rt
      LEFT JOIN type_nights tn
             ON tn.room_type_id = rt.id
            AND tn.night >= $1::date AND tn.night < $2::date   -- checkout day isn't a night: [)
     GROUP BY rt.id
     ORDER BY rt.id`, [ci, co]);
  res.json({ check_in: ci, check_out: co, room_types: r.rows });
});
