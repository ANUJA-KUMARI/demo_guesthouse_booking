// validate.ts - small input checks shared by the routes.
// WHY: catching obviously wrong input early gives a clear 400 message instead
// of a confusing database error.
import { HttpError } from './errors.js';

// Positive whole number, e.g. an id. Accepts "5" from the URL too.
export function toId(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive whole number`);
  return n;
}

// 'YYYY-MM-DD' that is a real calendar date.
export function toDate(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))
      || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v)
    throw new HttpError(400, `${name} must be a date like 2026-12-01`);
  return v;
}

// Check-in/check-out pair: check_out must be after check_in ('YYYY-MM-DD' compares correctly as text).
export function toStay(ci: unknown, co: unknown): [string, string] {
  const a = toDate(ci, 'check_in'), b = toDate(co, 'check_out');
  if (b <= a) throw new HttpError(400, 'check_out must be after check_in');
  return [a, b];
}
