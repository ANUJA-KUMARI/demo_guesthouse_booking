-- 010_auth.sql
-- WHAT: user accounts (login) with a ROLE: GUEST, MANAGER or ADMIN.
--       Plus the extra rights the app needs for room / room-type management.
-- WHY:  the API decides who may do what, but the DATABASE adds a second lock:
--       a staff account (MANAGER/ADMIN) can only be created on purpose,
--       never by accident through the normal signup code.

-- 1) The accounts table.
CREATE TABLE IF NOT EXISTS users (
  id             serial PRIMARY KEY,
  email          text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  password_hash  text NOT NULL,              -- bcrypt hash, NEVER the real password
  full_name      text NOT NULL CHECK (length(trim(full_name)) > 0),
  role           text NOT NULL DEFAULT 'GUEST' CHECK (role IN ('GUEST','MANAGER','ADMIN')),
  -- A GUEST account is linked to its row in guests, so "my bookings" =
  -- bookings WHERE guest_id = users.guest_id. Staff have no guest row (NULL).
  guest_id       int UNIQUE REFERENCES guests(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A guest MUST have a guest row; staff must NOT (keeps the data tidy).
  CHECK ((role = 'GUEST') = (guest_id IS NOT NULL))
);
-- One account per email, ignoring capitals (Asha@x.com = asha@x.com).
-- (The CHECK above already forces lower-case; the index makes it unique + fast to look up at login.)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

-- 2) Safeguard: staff accounts only when the session says so on purpose.
--    The admin endpoint and the create-admin script run
--      SELECT set_config('app.allow_staff_create', 'on', true)
--    inside their transaction ("true" = only for this transaction).
--    The signup code never does, so even if a bug passed role:'ADMIN'
--    to the INSERT, the database would refuse it.
CREATE OR REPLACE FUNCTION users_guard_staff() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role <> 'GUEST'
     AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role)
     AND COALESCE(current_setting('app.allow_staff_create', true), '') <> 'on' THEN
    RAISE EXCEPTION 'staff accounts (%) can only be created by an admin', NEW.role;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_guard_staff_trg ON users;
CREATE TRIGGER users_guard_staff_trg
BEFORE INSERT OR UPDATE OF role ON users
FOR EACH ROW EXECUTE FUNCTION users_guard_staff();

-- 3) If a manager changes a room type's capacity, the per-night counters
--    (type_nights.capacity, a copy) must follow for today and the future.
--    If some night already has more bookings than the new capacity, the
--    CHECK (booked <= capacity) fails and the whole UPDATE is refused (409).
CREATE OR REPLACE FUNCTION room_types_sync_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE type_nights SET capacity = NEW.capacity
   WHERE room_type_id = NEW.id AND night >= current_date;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS room_types_capacity_trg ON room_types;
CREATE TRIGGER room_types_capacity_trg
AFTER UPDATE OF capacity ON room_types
FOR EACH ROW WHEN (NEW.capacity IS DISTINCT FROM OLD.capacity)
EXECUTE FUNCTION room_types_sync_capacity();

-- 4) Rights for the API login (least privilege, as in 006).
GRANT SELECT, INSERT ON users TO guesthouse_app;
GRANT UPDATE (full_name, password_hash, role) ON users TO guesthouse_app;
-- Managers edit/delete rooms and room types. Deleting something still in use
-- fails with a foreign-key error (23503) which the API shows as 409.
GRANT UPDATE, DELETE ON room_types, rooms TO guesthouse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO guesthouse_app;
-- No DELETE on users: accounts are kept (bookings/history point at them).
