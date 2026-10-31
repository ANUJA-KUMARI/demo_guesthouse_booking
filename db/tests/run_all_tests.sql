-- run_all_tests.sql
-- WHAT: proves every rule in the database actually holds.
-- WHY BEGIN ... ROLLBACK: everything below is undone at the end, so you can
--     rerun this as often as you like and it never leaves test data behind.
-- HOW TO READ THE OUTPUT: each check prints "NOTICE: PASS: ...".
--     A failure prints "ERROR: FAIL: ..." and the script stops there.
-- "Expected failures" are written as BEGIN ... EXCEPTION ... END inside a DO block:
--     that inner block is a savepoint, so the error is caught and undone
--     without breaking the rest of the test run.

\set ON_ERROR_STOP on
BEGIN;

-- Our own test data, with names that won't clash with real data.
INSERT INTO room_types(name, capacity, rate_paise) VALUES
  ('TEST_Single', 1, 100000),   -- capacity 1: for overbooking tests
  ('TEST_Twin',   2, 200000);   -- 2 rooms: for check-in / room-change tests
INSERT INTO rooms(room_number, room_type_id)
  SELECT 'T901', id FROM room_types WHERE name = 'TEST_Single';
INSERT INTO rooms(room_number, room_type_id)
  SELECT n, id FROM room_types, (VALUES ('T911'),('T912')) v(n) WHERE name = 'TEST_Twin';
INSERT INTO guests(name, phone) VALUES ('TEST Guest', '0000000000');

-- Small helper so tests can say "make a booking" in one line. pg_temp = disappears after session.
CREATE FUNCTION pg_temp.book(p_type text, p_from date, p_to date) RETURNS int
LANGUAGE sql AS $$
  INSERT INTO bookings(guest_id, room_type_id, during)
  SELECT (SELECT id FROM guests WHERE name = 'TEST Guest'), rt.id, daterange(p_from, p_to)
    FROM room_types rt WHERE rt.name = p_type
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.room(p_no text) RETURNS int
LANGUAGE sql AS $$ SELECT id FROM rooms WHERE room_number = p_no $$;

-- 1. Capacity 1: 12-14 ok, 13-15 rejected, 13-14 rejected, 14-16 ok.
DO $$
BEGIN
  PERFORM pg_temp.book('TEST_Single', '2030-01-12', '2030-01-14');
  RAISE NOTICE 'PASS: 12-14 booked on empty capacity-1 type';

  BEGIN
    PERFORM pg_temp.book('TEST_Single', '2030-01-13', '2030-01-15');
    RAISE EXCEPTION 'FAIL: 13-15 was accepted (overbooking)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: 13-15 rejected (night 13 full)';
  END;

  BEGIN
    PERFORM pg_temp.book('TEST_Single', '2030-01-13', '2030-01-14');
    RAISE EXCEPTION 'FAIL: 13-14 was accepted (overbooking)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: 13-14 rejected';
  END;

  PERFORM pg_temp.book('TEST_Single', '2030-01-14', '2030-01-16');
  RAISE NOTICE 'PASS: 14-16 booked (checkout day 14 is free)';
END $$;

-- 2. Raw SQL can't overbook either (no helper, plain INSERT).
DO $$
BEGIN
  BEGIN
    INSERT INTO bookings(guest_id, room_type_id, during)
    SELECT g.id, rt.id, '[2030-01-12,2030-01-13)'
      FROM guests g, room_types rt WHERE g.name = 'TEST Guest' AND rt.name = 'TEST_Single';
    RAISE EXCEPTION 'FAIL: raw INSERT overbooked';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: raw-SQL overbooking rejected by the database';
  END;
END $$;

-- 3. Stays: same-day boundary on one room ok; overlapping assignment rejected.
DO $$
DECLARE b1 int; b2 int; b3 int;
BEGIN
  b1 := pg_temp.book('TEST_Twin', '2030-02-01', '2030-02-03');
  b2 := pg_temp.book('TEST_Twin', '2030-02-03', '2030-02-05');
  b3 := pg_temp.book('TEST_Twin', '2030-02-02', '2030-02-04');
  INSERT INTO stays(booking_id, room_id, during) VALUES (b1, pg_temp.room('T911'), '[2030-02-01,2030-02-03)');
  INSERT INTO stays(booking_id, room_id, during) VALUES (b2, pg_temp.room('T911'), '[2030-02-03,2030-02-05)');
  RAISE NOTICE 'PASS: same-day checkout/check-in on the same room allowed';
  BEGIN
    INSERT INTO stays(booking_id, room_id, during) VALUES (b3, pg_temp.room('T911'), '[2030-02-02,2030-02-04)');
    RAISE EXCEPTION 'FAIL: room T911 double-assigned';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: double assignment of a room rejected';
  END;
END $$;

-- 4. check_in, 5. change_room rollback, 6-8. folio, 9. check_out.
DO $$
DECLARE b int; other int; empty_b int; n int; bal int;
BEGIN
  b := pg_temp.book('TEST_Twin', '2030-03-10', '2030-03-13');
  PERFORM check_in(b, pg_temp.room('T911'));
  SELECT count(*) INTO n FROM stays
   WHERE booking_id = b AND room_id = pg_temp.room('T911') AND status = 'CONFIRMED'
     AND during = '[2030-03-10,2030-03-13)';
  IF n <> 1 OR (SELECT status FROM bookings WHERE id = b) <> 'CHECKED_IN'
     OR NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = b AND event_type = 'CHECKED_IN')
  THEN RAISE EXCEPTION 'FAIL: check_in did not create stay / status / event'; END IF;
  RAISE NOTICE 'PASS: check_in created stay, set CHECKED_IN, logged event';

  -- Block room T912 with another guest, then try to move there: must fail and change nothing.
  other := pg_temp.book('TEST_Twin', '2030-03-11', '2030-03-12');
  PERFORM check_in(other, pg_temp.room('T912'));
  BEGIN
    PERFORM change_room(b, pg_temp.room('T912'), '2030-03-11');
    RAISE EXCEPTION 'FAIL: change_room into an occupied room succeeded';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM stays
   WHERE booking_id = b AND status = 'CONFIRMED' AND room_id = pg_temp.room('T911')
     AND during = '[2030-03-10,2030-03-13)';
  IF n <> 1 OR (SELECT count(*) FROM stays WHERE booking_id = b) <> 1 THEN
    RAISE EXCEPTION 'FAIL: failed change_room left a partial change';
  END IF;
  RAISE NOTICE 'PASS: change_room to a taken room rolled back, original stay intact';

  -- Free T912 (other guest checks out), then the move works.
  PERFORM check_out(other);
  PERFORM change_room(b, pg_temp.room('T912'), '2030-03-11');
  IF NOT EXISTS (SELECT 1 FROM stays WHERE booking_id = b AND status = 'ENDED'
                   AND room_id = pg_temp.room('T911') AND during = '[2030-03-10,2030-03-11)')
     OR NOT EXISTS (SELECT 1 FROM stays WHERE booking_id = b AND status = 'CONFIRMED'
                   AND room_id = pg_temp.room('T912') AND during = '[2030-03-11,2030-03-13)')
  THEN RAISE EXCEPTION 'FAIL: change_room did not split the stay correctly'; END IF;
  RAISE NOTICE 'PASS: change_room split stay (old ENDED, new CONFIRMED)';

  -- Folio: append-only.
  INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
  VALUES (b, 'CHARGE', 600000, '3 nights'), (b, 'PAYMENT', 500000, 'cash');
  BEGIN
    UPDATE folio_lines SET amount_paise = 1 WHERE booking_id = b;
    RAISE EXCEPTION 'FAIL: folio UPDATE allowed';
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: UPDATE on folio_lines rejected';
  END;
  BEGIN
    DELETE FROM folio_lines WHERE booking_id = b;
    RAISE EXCEPTION 'FAIL: folio DELETE allowed';
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: DELETE on folio_lines rejected';
  END;

  -- Balance: 600000 charge - 500000 payment = 100000; add credit 20000 and refund 5000 -> 85000.
  INSERT INTO folio_lines(booking_id, kind, amount_paise) VALUES (b,'CREDIT',20000),(b,'REFUND',5000);
  SELECT balance_paise INTO bal FROM booking_balances WHERE booking_id = b;
  IF bal <> 85000 THEN RAISE EXCEPTION 'FAIL: balance is %, expected 85000', bal; END IF;
  empty_b := pg_temp.book('TEST_Twin','2030-05-01','2030-05-02');
  IF (SELECT balance_paise FROM booking_balances WHERE booking_id = empty_b) <> 0
  THEN RAISE EXCEPTION 'FAIL: booking with no folio lines should have balance 0'; END IF;
  RAISE NOTICE 'PASS: booking_balances correct (85000, and 0 with no lines)';

  -- check_out refused while money is owed, then works after paying.
  BEGIN
    PERFORM check_out(b);
    RAISE EXCEPTION 'FAIL: check_out allowed with unpaid balance';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: check_out refused: %', SQLERRM;
  END;
  INSERT INTO folio_lines(booking_id, kind, amount_paise, description) VALUES (b,'PAYMENT',85000,'settle');
  PERFORM check_out(b);
  IF (SELECT status FROM bookings WHERE id = b) <> 'CHECKED_OUT'
     OR EXISTS (SELECT 1 FROM stays WHERE booking_id = b AND status = 'CONFIRMED')
  THEN RAISE EXCEPTION 'FAIL: check_out did not close booking/stay'; END IF;
  RAISE NOTICE 'PASS: check_out succeeded after payment';
END $$;

-- 10. Cancelling frees capacity.
DO $$
DECLARE b int;
BEGIN
  b := pg_temp.book('TEST_Single', '2030-04-01', '2030-04-03');
  UPDATE bookings SET status = 'CANCELLED' WHERE id = b;
  PERFORM pg_temp.book('TEST_Single', '2030-04-01', '2030-04-03');
  IF NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = b AND event_type = 'CANCELLED')
  THEN RAISE EXCEPTION 'FAIL: cancel not logged'; END IF;
  RAISE NOTICE 'PASS: cancelled booking freed the room type for the same nights';
END $$;

-- 11. History is append-only too.
DO $$
BEGIN
  BEGIN
    DELETE FROM booking_events;
    RAISE EXCEPTION 'FAIL: booking_events DELETE allowed';
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: DELETE on booking_events rejected';
  END;
  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

ROLLBACK;
