-- 008_indexes.sql
-- WHAT: indexes = a book's index for tables, so lookups don't scan every row.
-- WHY each one is listed beside it. IF NOT EXISTS makes re-running safe.

-- "Show all bookings for this guest" (guest history screen).
CREATE INDEX IF NOT EXISTS bookings_guest_idx     ON bookings(guest_id);
-- "Bookings of this room type" (availability and reports).
CREATE INDEX IF NOT EXISTS bookings_type_idx      ON bookings(room_type_id);
-- "Bookings overlapping these dates" (arrivals/departures screen) - gist understands ranges.
CREATE INDEX IF NOT EXISTS bookings_during_idx    ON bookings USING gist(during);
-- "Find the stay(s) for this booking" (used by change_room and check_out).
CREATE INDEX IF NOT EXISTS stays_booking_idx      ON stays(booking_id);
-- A booking can be in only ONE room at a time: at most one CONFIRMED stay per booking.
CREATE UNIQUE INDEX IF NOT EXISTS stays_one_active_per_booking
  ON stays(booking_id) WHERE status = 'CONFIRMED';
-- "Lines on this bill" (balance view, folio screen).
CREATE INDEX IF NOT EXISTS folio_lines_booking_idx    ON folio_lines(booking_id);
-- "History of this booking" (event timeline).
CREATE INDEX IF NOT EXISTS booking_events_booking_idx ON booking_events(booking_id);
