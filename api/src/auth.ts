// auth.ts - who is calling? (login cookie) and are they allowed? (role check)
//
// HOW LOGIN WORKS (simple version):
//  1. On login we check the password against the bcrypt hash in the users table.
//  2. If it matches we create a JWT: a small text "ticket" saying {uid, role},
//     SIGNED with JWT_SECRET. Anyone can read a JWT, but nobody can CHANGE it
//     (e.g. role GUEST -> ADMIN) without the secret, because the signature breaks.
//  3. We put the ticket in an httpOnly cookie. httpOnly = page JavaScript can't
//     read it, so an XSS bug can't steal it. The browser sends it automatically.
//  4. requireAuth reads the cookie on every request, checks the signature, and
//     loads the user FRESH from the database (so a changed role applies at once).
import type { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { HttpError } from './errors.js';

export type Role = 'GUEST' | 'MANAGER' | 'ADMIN';
export interface AuthUser { id: number; email: string; full_name: string; role: Role; guest_id: number | null }

// Teach TypeScript that req.user exists (set by requireAuth).
declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export const COOKIE_NAME = 'gh_token';
const TOKEN_HOURS = 8;   // a working shift; after that, log in again

// Refuse to start with a missing/weak secret: a guessable secret = anyone can forge an ADMIN ticket.
const SECRET = process.env.JWT_SECRET ?? '';
if (SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long');
}

// Cookie settings come from .env so the same code works locally and online.
// lax  = sent on same-site requests only (blocks most CSRF). Default, works with the /api proxy.
// none = needed only if the website and API are on DIFFERENT domains (then secure must be true).
export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') ?? 'lax',
    secure: process.env.COOKIE_SECURE === 'true',   // true = only over https (use online)
    maxAge: TOKEN_HOURS * 3600 * 1000,
    path: '/',
  };
}

export function setLoginCookie(res: Response, user: AuthUser) {
  const token = jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: `${TOKEN_HOURS}h` });
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearLoginCookie(res: Response) {
  const { maxAge: _ignore, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

// Reads the cookie and loads the user. Throws 401 if not logged in
// (no cookie, forged/expired ticket, or the account no longer exists).
async function loadUser(req: Request): Promise<AuthUser> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Please log in');
  let uid: number;
  try {
    uid = (jwt.verify(token, SECRET) as { uid: number }).uid;   // throws if forged or expired
  } catch {
    throw new HttpError(401, 'Session expired, please log in again');
  }
  const r = await pool.query(
    'SELECT id, email, full_name, role, guest_id FROM users WHERE id = $1', [uid]);
  if (!r.rows[0]) throw new HttpError(401, 'Account not found');
  return r.rows[0];
}

// Middleware: must be logged in (any role).
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = await loadUser(req);
  next();
}

// Middleware factory: requireRole('MANAGER','ADMIN') = logged in AND one of these roles.
// 401 = "who are you?"   403 = "I know who you are, but you may not do this".
export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.user = await loadUser(req);
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission for this');
    next();
  };
}

// Ready-made names so routes read like English: bookings.post('/x', staff, handler)
export const loggedIn = requireAuth;
export const staff = requireRole('MANAGER', 'ADMIN');
export const adminOnly = requireRole('ADMIN');

export const isStaff = (u: AuthUser) => u.role === 'MANAGER' || u.role === 'ADMIN';

// A guest may only touch THEIR OWN booking. We answer 404 (not 403) so a
// guest can't even find out that booking #57 exists.
export function assertOwnBooking(u: AuthUser, bookingGuestId: number) {
  if (!isStaff(u) && bookingGuestId !== u.guest_id) throw new HttpError(404, 'Booking not found');
}
