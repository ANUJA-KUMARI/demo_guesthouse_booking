-- 007_procedures.sql
-- WHAT: check_in, change_room, check_out as database functions.
-- WHY:  each one is several steps that must ALL happen or NONE happen.
--       A function runs inside the caller's transaction, so if any step raises
--       an error, PostgreSQL undoes every step of it automatically (rollback).
-- Status events (CHECKED_IN / CHECKED_OUT) are logged by the trigger from 005,
-- so these functions only log what the trigger can't see (ROOM_CHANGED).

-- CHECK-IN: turn a booking ("a Deluxe, 12th-14th") into a stay in a real room.
CREATE OR REPLACE FUNCTION check_in(p_booking_id int, p_room_id int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  b       bookings%ROWTYPE;
  r_type  int;
  new_id  int;
BEGIN
  -- FOR UPDATE locks the booking so two clerks can't check it in at the same time.
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking % does not exist', p_booking_id; END IF;
  IF b.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'booking % is %, only CONFIRMED bookings can check in', p_booking_id, b.status;
  END IF;

  SELECT room_type_id INTO r_type FROM rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'room % does not exist', p_room_id; END IF;
  IF r_type <> b.room_type_id THEN
    RAISE EXCEPTION 'room % is not the booked room type', p_room_id;
  END IF;

  -- If the room is already taken for these nights, the EXCLUDE rule in stays
  -- raises "conflicting key value violates exclusion constraint" right here.
  INSERT INTO stays(booking_id, room_id, during)
  VALUES (b.id, p_room_id, b.during) RETURNING id INTO new_id;

  UPDATE bookings SET status = 'CHECKED_IN' WHERE id = b.id;  -- trigger logs CHECKED_IN
  RETURN new_id;
END $$;

-- ROOM CHANGE: move a checked-in guest to another room of the SAME type
-- from p_on_date onwards. Same type only, because capacity is counted per type.
CREATE OR REPLACE FUNCTION change_room(p_booking_id int, p_new_room_id int,
                                       p_on_date date DEFAULT current_date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  b       bookings%ROWTYPE;
  s       stays%ROWTYPE;
  r_type  int;
  new_id  int;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking % does not exist', p_booking_id; END IF;
  IF b.status <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'booking % is %, must be CHECKED_IN to change room', p_booking_id, b.status;
  END IF;

  SELECT * INTO s FROM stays
   WHERE booking_id = p_booking_id AND status = 'CONFIRMED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking % has no active stay', p_booking_id; END IF;
  IF s.room_id = p_new_room_id THEN RAISE EXCEPTION 'guest is already in room %', p_new_room_id; END IF;

  SELECT room_type_id INTO r_type FROM rooms WHERE id = p_new_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'room % does not exist', p_new_room_id; END IF;
  IF r_type <> b.room_type_id THEN
    RAISE EXCEPTION 'room change must stay within the same room type';
  END IF;
  IF NOT (p_on_date >= lower(s.during) AND p_on_date < upper(s.during)) THEN
    RAISE EXCEPTION 'change date % is outside the stay %', p_on_date, s.during;
  END IF;

  -- Step 1: END the old stay FIRST. Order matters: the old stay must stop
  -- "holding" those nights before the new stay is inserted.
  IF p_on_date = lower(s.during) THEN
    UPDATE stays SET status = 'VOIDED' WHERE id = s.id;   -- moved on day one: old stay never really happened
  ELSE
    UPDATE stays SET status = 'ENDED', during = daterange(lower(s.during), p_on_date)
     WHERE id = s.id;                                     -- keep the nights already slept there
  END IF;

  -- Step 2: new stay for the remaining nights. If the new room is taken, this
  -- raises an error and Step 1 is undone too: all-or-nothing.
  INSERT INTO stays(booking_id, room_id, during)
  VALUES (b.id, p_new_room_id, daterange(p_on_date, upper(s.during)))
  RETURNING id INTO new_id;

  INSERT INTO booking_events(booking_id, event_type, details)
  VALUES (b.id, 'ROOM_CHANGED', jsonb_build_object(
          'from_room', s.room_id, 'to_room', p_new_room_id, 'on', p_on_date));
  RETURN new_id;
END $$;

-- CHECK-OUT: only when the bill is fully settled (balance = 0).
CREATE OR REPLACE FUNCTION check_out(p_booking_id int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  b    bookings%ROWTYPE;
  bal  int;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking % does not exist', p_booking_id; END IF;
  IF b.status <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'booking % is %, must be CHECKED_IN to check out', p_booking_id, b.status;
  END IF;

  SELECT balance_paise INTO bal FROM booking_balances WHERE booking_id = p_booking_id;
  IF bal <> 0 THEN
    RAISE EXCEPTION 'cannot check out booking %: balance is % paise (must be 0)', p_booking_id, bal;
  END IF;

  UPDATE stays SET status = 'ENDED' WHERE booking_id = p_booking_id AND status = 'CONFIRMED';
  UPDATE bookings SET status = 'CHECKED_OUT' WHERE id = p_booking_id;  -- trigger logs CHECKED_OUT
END $$;

GRANT EXECUTE ON FUNCTION check_in(int,int), change_room(int,int,date), check_out(int)
  TO guesthouse_app;
