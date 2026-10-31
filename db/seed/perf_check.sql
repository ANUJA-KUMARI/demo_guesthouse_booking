-- perf_check.sql
-- WHAT: row counts + EXPLAIN (ANALYZE, BUFFERS) on the exact queries the API runs.
-- WHY:  shows whether PostgreSQL uses our indexes and how many ms each query takes.
-- Read-only: EXPLAIN ANALYZE of SELECTs changes nothing.
-- $1/$2 from the API code are replaced with real example values.

\pset pager off
\timing on

\echo '===== Row counts ====='
SELECT 'room_types' AS tbl, count(*) FROM room_types
UNION ALL SELECT 'rooms',          count(*) FROM rooms
UNION ALL SELECT 'guests',         count(*) FROM guests
UNION ALL SELECT 'bookings',       count(*) FROM bookings
UNION ALL SELECT 'type_nights',    count(*) FROM type_nights
UNION ALL SELECT 'stays',          count(*) FROM stays
UNION ALL SELECT 'booking_events', count(*) FROM booking_events
UNION ALL SELECT 'folio_lines',    count(*) FROM folio_lines;

SELECT status, count(*) FROM bookings GROUP BY status ORDER BY status;

SELECT sum(n) AS total_rows FROM (
  SELECT count(*) n FROM room_types UNION ALL SELECT count(*) FROM rooms
  UNION ALL SELECT count(*) FROM guests UNION ALL SELECT count(*) FROM bookings
  UNION ALL SELECT count(*) FROM type_nights UNION ALL SELECT count(*) FROM stays
  UNION ALL SELECT count(*) FROM booking_events UNION ALL SELECT count(*) FROM folio_lines) x;

\echo '===== Sanity: no night is over capacity, counters match bookings ====='
SELECT count(*) AS over_capacity_nights FROM type_nights WHERE booked > capacity;
SELECT count(*) AS counter_mismatches FROM type_nights tn
 WHERE tn.booked <> (SELECT count(*) FROM bookings b
                      WHERE b.room_type_id = tn.room_type_id AND b.status <> 'CANCELLED'
                        AND b.during @> tn.night);
SELECT count(*) AS checked_out_with_balance FROM bookings b
  JOIN booking_balances bb ON bb.booking_id = b.id
 WHERE b.status = 'CHECKED_OUT' AND bb.balance_paise <> 0;

-- Pick a real booking id that has a stay, events and folio lines (ids have gaps
-- because skipped bookings still used up a number from the sequence).
SELECT max(booking_id) AS bid FROM folio_lines \gset
\echo 'Example booking id:' :bid

\echo '===== 1) GET /availability (search screen) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT rt.id AS room_type_id, rt.name, rt.capacity, rt.rate_paise,
       COALESCE(MAX(tn.booked), 0)::int AS max_booked,
       (rt.capacity - COALESCE(MAX(tn.booked), 0))::int AS free
  FROM room_types rt
  LEFT JOIN type_nights tn
         ON tn.room_type_id = rt.id
        AND tn.night >= '2026-12-20'::date AND tn.night < '2026-12-24'::date
 GROUP BY rt.id ORDER BY rt.id;

\echo '===== 2) GET /bookings/:id (one booking) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.id, b.guest_id, b.room_type_id, b.status, b.created_at,
       to_char(lower(b.during),'YYYY-MM-DD'), to_char(upper(b.during),'YYYY-MM-DD')
  FROM bookings b WHERE b.id = :bid;

\echo '===== 3) stays of a booking ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.id, s.room_id, r.room_number, s.status
  FROM stays s JOIN rooms r ON r.id = s.room_id
 WHERE s.booking_id = :bid ORDER BY s.id;

\echo '===== 4) events of a booking ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, event_type, details, created_at FROM booking_events WHERE booking_id = :bid ORDER BY id;

\echo '===== 5) balance of a booking (view) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT balance_paise FROM booking_balances WHERE booking_id = :bid;

\echo '===== 6) folio lines of a booking ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, kind, amount_paise, description, created_at FROM folio_lines WHERE booking_id = :bid ORDER BY id;

\echo '===== 7) GET /rooms/free (check-in screen) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.room_number, r.room_type_id
  FROM rooms r
 WHERE r.room_type_id = (SELECT min(id) FROM room_types WHERE name = 'Deluxe King')
   AND NOT EXISTS (SELECT 1 FROM stays s
                    WHERE s.room_id = r.id AND s.status = 'CONFIRMED'
                      AND s.during && daterange('2026-10-28', '2026-10-31', '[)'))
 ORDER BY r.room_number;

\echo '===== 8) GET /bookings?status=CONFIRMED (list screen, returns many rows) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.id, g.name, rt.name, b.status
  FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN room_types rt ON rt.id = b.room_type_id
 WHERE ('CONFIRMED'::text IS NULL OR b.status = 'CONFIRMED')
 ORDER BY lower(b.during), b.id;

\echo '===== 9) bookings of one guest (bookings_guest_idx) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, during FROM bookings WHERE guest_id = 42;

\echo '===== 10) bookings overlapping a date range (bookings_during_idx, gist) ====='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status FROM bookings WHERE during && daterange('2026-12-24','2026-12-26');
