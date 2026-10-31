// auth.ts (routes) - signup, login, logout, "who am I".
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';
import { withTransaction } from '../tx.js';
import { HttpError } from '../errors.js';
import { clearLoginCookie, requireAuth, setLoginCookie } from '../auth.js';
import type { AuthUser } from '../auth.js';
import { checkPassword, hashPassword, requiredText, validEmail, validPassword } from '../passwords.js';

export const auth = Router();

// Max 10 FAILED logins per 15 minutes per IP, then 429 "Too many requests".
// Stops a script from guessing passwords. Successful logins aren't counted.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many failed logins. Wait 15 minutes and try again.' },
});

// POST /auth/signup { email, password, full_name, phone }
// ALWAYS creates a GUEST. We never read req.body.role - so sending
// role:'ADMIN' does nothing. (And the DB trigger in 010 would refuse it anyway.)
auth.post('/auth/signup', async (req, res) => {
  const email = validEmail(req.body?.email);
  const password = validPassword(req.body?.password);
  const fullName = requiredText(req.body?.full_name, 'full_name');
  const phone = requiredText(req.body?.phone, 'phone');
  const hash = await hashPassword(password);

  // Two inserts (guest row + account) = one transaction: both or neither.
  const user = await withTransaction(async (c) => {
    const exists = await c.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rows[0]) throw new HttpError(409, 'An account with this email already exists');
    const g = await c.query('INSERT INTO guests(name, phone, email) VALUES ($1, $2, $3) RETURNING id',
                            [fullName, phone, email]);
    const u = await c.query(
      `INSERT INTO users(email, password_hash, full_name, role, guest_id)
       VALUES ($1, $2, $3, 'GUEST', $4)
       RETURNING id, email, full_name, role, guest_id`, [email, hash, fullName, g.rows[0].id]);
    return u.rows[0] as AuthUser;
  });
  setLoginCookie(res, user);     // signed up = logged in
  res.status(201).json({ user });
});

// POST /auth/login { email, password }
auth.post('/auth/login', loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const r = await pool.query(
    'SELECT id, email, full_name, role, guest_id, password_hash FROM users WHERE lower(email) = $1', [email]);
  const row = r.rows[0];
  // Same message for "no such email" and "wrong password": don't tell an
  // attacker which emails have accounts.
  if (!row || !(await checkPassword(password, row.password_hash)))
    throw new HttpError(401, 'Wrong email or password');
  const { password_hash: _hidden, ...user } = row;   // never send the hash to the browser
  setLoginCookie(res, user);
  res.json({ user });
});

// POST /auth/logout - delete the cookie.
auth.post('/auth/logout', (_req, res) => {
  clearLoginCookie(res);
  res.json({ ok: true });
});

// GET /auth/me - React calls this on page load to know who is logged in.
auth.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
