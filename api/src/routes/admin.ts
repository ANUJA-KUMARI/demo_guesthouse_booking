// admin.ts - ADMIN ONLY: create and list staff (manager) accounts.
import { Router } from 'express';
import { pool } from '../db.js';
import { withTransaction } from '../tx.js';
import { HttpError } from '../errors.js';
import { adminOnly } from '../auth.js';
import { hashPassword, requiredText, validEmail, validPassword } from '../passwords.js';

export const admin = Router();

// GET /admin/users -> all staff accounts (managers + admins), never the hashes.
admin.get('/admin/users', adminOnly, async (_req, res) => {
  const r = await pool.query(
    `SELECT id, email, full_name, role, created_at FROM users
      WHERE role IN ('MANAGER','ADMIN') ORDER BY role, id`);
  res.json(r.rows);
});

// POST /admin/users { email, password, full_name } -> 201 new MANAGER
admin.post('/admin/users', adminOnly, async (req, res) => {
  const email = validEmail(req.body?.email);
  const password = validPassword(req.body?.password);
  const fullName = requiredText(req.body?.full_name, 'full_name');
  const hash = await hashPassword(password);

  const user = await withTransaction(async (c) => {
    // Flip the DB safeguard switch from 010 ON, for THIS transaction only
    // (3rd argument true = "local"). It turns off by itself at COMMIT/ROLLBACK.
    await c.query("SELECT set_config('app.allow_staff_create', 'on', true)");
    const exists = await c.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rows[0]) throw new HttpError(409, 'An account with this email already exists');
    const r = await c.query(
      `INSERT INTO users(email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'MANAGER') RETURNING id, email, full_name, role, created_at`,
      [email, hash, fullName]);
    return r.rows[0];
  });
  res.status(201).json(user);
});
