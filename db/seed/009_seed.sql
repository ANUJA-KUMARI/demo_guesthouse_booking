-- 009_seed.sql
-- WHAT: fills the database with a realistic year (2026) of demo data:
--       6 room types, 40 rooms, 1500 guests, 4500 booking attempts (~3000+ succeed),
--       check-ins, check-outs, cancellations and bills (folio lines).
-- WHY:  with 5 rows every query is fast. With thousands of rows we can
--       prove (a) the rules still hold and (b) the indexes are really used.
-- HOW:  every row goes through the REAL rules: the capacity trigger,
--       the stays exclusion constraint and the check_in / check_out functions.
--       Nothing is disabled. A booking that would overbook is simply skipped.
-- DETERMINISTIC: no random(); every value is computed from the loop counter
--       (hashint4(i) scrambles i the same way every time),
--       so everyone who runs this gets exactly the same data.
-- SAFE TO RE-RUN: if the seed was already loaded it stops with a notice.
-- "Today" for the seed is fixed at 2026-10-29, so stays before it are
--       checked out, stays around it are checked in, later ones are confirmed.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  seed_today  constant date := '2026-10-29';
  t_ids   int[];
  i       int;
  g       int;
  t       int;
  ci      date;
  co      date;
  nights  int;
  bid     int;
  rid     int;
  rate    int;
  total   int;
  ok      int := 0;
  skipped int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM room_types WHERE name = 'Standard Single') THEN
    RAISE NOTICE 'Seed already loaded - nothing to do.';
    RETURN;
  END IF;

  -- 1) Room types. capacity = how many rooms of that type we own (10+8+8+6+4+4 = 40).
  INSERT INTO room_types(name, capacity, rate_paise) VALUES
    ('Standard Single', 10, 150000),
    ('Standard Double',  8, 220000),
    ('Deluxe King',      8, 320000),
    ('Garden Twin',      6, 280000),
    ('Family Suite',     4, 450000),
    ('Executive Suite',  4, 600000);
  SELECT array_agg(id ORDER BY id) INTO t_ids FROM room_types
   WHERE name IN ('Standard Single','Standard Double','Deluxe King',
                  'Garden Twin','Family Suite','Executive Suite');

  -- 2) Rooms: floor = type (2xx, 3xx ... 7xx), so numbers never clash with room 101.
  INSERT INTO rooms(room_number, room_type_id)
  SELECT (k + 1) * 100 + n, rt.id
    FROM unnest(t_ids) WITH ORDINALITY AS u(id, k)
    JOIN room_types rt ON rt.id = u.id,
         generate_series(1, rt.capacity) AS n;

  -- 3) 1500 guests with made-up but realistic names/phones.
  INSERT INTO guests(name, phone, email)
  SELECT (ARRAY['Aarav','Diya','Kabir','Meera','Rohan','Isha','Vikram','Ananya','Arjun','Sara'])[1 + n % 10]
         || ' ' ||
         (ARRAY['Sharma','Iyer','Patel','Reddy','Khan','Das','Nair','Gupta','Singh','Joshi','Rao','Mehta'])[1 + (n / 10) % 12]
         || ' ' || n,
         '9' || lpad((n * 7919 % 1000000000)::text, 9, '0'),
         'seed.guest' || n || '@example.com'
    FROM generate_series(1, 1500) AS n;

  -- 4) Bookings. 4500 attempts spread over 2026; overbooking ones are skipped.
  FOR i IN 1..4500 LOOP
    g      := (SELECT min(id) FROM guests WHERE email = 'seed.guest1@example.com') + (i * 17) % 1500;
    t      := t_ids[1 + abs(hashint4(i + 100000)) % 6];   -- hashint4 = built-in, always same output
    nights := 1 + abs(hashint4(i + 200000)) % 4;        -- 1..4 nights
    ci     := date '2026-01-01' + abs(hashint4(i)) % 361; -- check-in somewhere in 2026
    co     := ci + nights;

    BEGIN   -- inner block = savepoint: a failure undoes only this one booking
      INSERT INTO bookings(guest_id, room_type_id, during)
      VALUES (g, t, daterange(ci, co, '[)'))
      RETURNING id INTO bid;
    EXCEPTION WHEN check_violation THEN   -- type_nights CHECK(booked <= capacity)
      skipped := skipped + 1;
      CONTINUE;
    END;
    ok := ok + 1;

    -- 1 in 10 bookings gets cancelled (frees its nights again through the trigger).
    IF i % 10 = 0 THEN
      UPDATE bookings SET status = 'CANCELLED' WHERE id = bid;
      CONTINUE;
    END IF;

    -- Future bookings stay CONFIRMED. Past/current ones get a real room.
    CONTINUE WHEN ci > seed_today;

    -- Find a room of this type that is free for the whole stay (same query as GET /rooms/free).
    SELECT r.id INTO rid FROM rooms r
     WHERE r.room_type_id = t
       AND NOT EXISTS (SELECT 1 FROM stays s
                        WHERE s.room_id = r.id AND s.status = 'CONFIRMED'
                          AND s.during && daterange(ci, co, '[)'))
     ORDER BY r.room_number LIMIT 1;
    -- Every night has capacity, but no single room may be free for ALL nights
    -- (fragmentation). Real hotels move guests; we just leave it CONFIRMED (a "no-show").
    CONTINUE WHEN rid IS NULL;

    PERFORM check_in(bid, rid);
    SELECT rate_paise INTO rate FROM room_types WHERE id = t;
    total := rate * nights;
    INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
    VALUES (bid, 'CHARGE', total, nights || ' night(s) room charge');

    IF co <= seed_today THEN
      -- Finished stay: pay in full (sometimes with a discount credit), then check out.
      IF i % 7 = 0 THEN
        INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
        VALUES (bid, 'CREDIT', total / 10, '10% loyalty discount'),
               (bid, 'PAYMENT', total - total / 10, 'UPI payment');
      ELSE
        INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
        VALUES (bid, 'PAYMENT', total, 'Card payment');
      END IF;
      PERFORM check_out(bid);           -- refuses unless balance = 0
    ELSE
      -- Guest is in the house right now: advance payment of half.
      INSERT INTO folio_lines(booking_id, kind, amount_paise, description)
      VALUES (bid, 'PAYMENT', total / 2, 'Advance at check-in');
    END IF;
  END LOOP;

  RAISE NOTICE 'Seed done: % bookings created, % skipped (would overbook)', ok, skipped;
END $$;

COMMIT;

-- Refresh the planner's statistics so EXPLAIN sees the real row counts.
ANALYZE;
