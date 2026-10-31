// passwords.ts - hashing with bcrypt.
// WHY a hash? We never store the real password. bcrypt is one-way (can't be
// reversed), adds a random "salt" (two users with the same password get
// different hashes) and is deliberately SLOW (cost 10 = ~1024 rounds), so
// guessing millions of passwords from a stolen table takes forever.
import bcrypt from 'bcryptjs';
import { HttpError } from './errors.js';

const COST = 10;
export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function validEmail(v: unknown): string {
  if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
    throw new HttpError(400, 'Please enter a valid email');
  return v.trim().toLowerCase();         // store lower-case: Asha@X.com = asha@x.com
}

export function validPassword(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8 || v.length > 72)   // bcrypt only uses the first 72 bytes
    throw new HttpError(400, 'Password must be 8 to 72 characters');
  return v;
}

export function requiredText(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} is required`);
  return v.trim();
}
