// errors.ts - turns database errors into the right HTTP status code.
//
// WHY: the DATABASE enforces our rules (capacity, no double room, bill
// can't be edited...). When a rule is broken Postgres throws an error with a
// 5-character "SQLSTATE" code. Instead of repeating try/catch in every route,
// we translate those codes here, in one place.
import type { Request, Response, NextFunction } from 'express';

// Our own error for "the request is wrong" checks done in the API itself.
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function toHttp(e: any): { status: number; error: string } {
  if (e instanceof HttpError) return { status: e.status, error: e.message };
  // Errors made by Express itself, e.g. broken JSON in the body (400) or a body that is too big (413).
  if (e?.expose && e.status >= 400 && e.status < 500) return { status: e.status, error: e.message };

  switch (e?.code) {
    case '23514': // check_violation: e.g. type_nights booked > capacity
      return { status: 409, error: 'No rooms of this type left for those dates' };
    case '23P01': // exclusion_violation: the EXCLUDE rule on stays
      return { status: 409, error: 'Room already occupied for those dates' };
    case '23503': // foreign_key_violation: guest / room type / booking doesn't exist
      return { status: 404, error: 'Linked record not found (guest, room type, room or booking)' };
    case '23505': // unique_violation: e.g. a second active stay for one booking
      return { status: 409, error: 'Duplicate: that record already exists' };
    case '22007': // invalid_datetime_format, e.g. '2026-13-45'
    case '22008': // datetime_field_overflow
    case '22P02': // invalid_text_representation, e.g. 'abc' where a number is expected
      return { status: 400, error: 'Invalid value in request (check dates and numbers)' };
    case '42501': // insufficient_privilege: the app login is not allowed to do this
      return { status: 403, error: 'Not allowed (append-only or missing permission)' };
    case 'P0001': { // RAISE EXCEPTION from our functions in 007 (and 005's forbid_change)
      const msg: string = e.message ?? 'Rule violated';
      // "booking 5 does not exist" / "room 9 does not exist"
      if (msg.includes('does not exist')) return { status: 404, error: msg };
      // "cannot check out booking 5: balance is 1000 paise (must be 0)"
      // "room 9 is not the booked room type", "change date ... is outside the stay",
      // "room change must stay within the same room type"
      // -> 422: the request is understood but breaks a business rule
      if (/balance is|not the booked room type|same room type|outside the stay/.test(msg))
        return { status: 422, error: msg };
      // "booking 5 is CANCELLED, only CONFIRMED bookings can check in",
      // "guest is already in room 2", "has no active stay", append-only -> 409 (state conflict)
      return { status: 409, error: msg };
    }
  }
  return { status: 500, error: 'Server error' };
}

// Express error middleware (4 arguments = Express knows it handles errors).
// Express 5 automatically sends errors thrown in async routes here.
export function errorHandler(e: any, _req: Request, res: Response, _next: NextFunction) {
  const { status, error } = toHttp(e);
  if (status === 500) console.error(e); // only log real surprises
  res.status(status).json({ error });
}
