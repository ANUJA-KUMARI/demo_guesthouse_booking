-- 006_roles.sql
-- WHAT: a separate, low-privilege login for the API ("guesthouse_app").
-- WHY:  "least privilege". If the API has a bug (or gets hacked), the database
--       itself still refuses to edit/delete the bill or history. The postgres
--       superuser stays for you (the admin) only.

-- 1) Create the role only if it doesn't exist yet (so re-running doesn't crash).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guesthouse_app') THEN
    -- !!! CHANGE 'change_me' to a real password, and put the same one in api/.env
    --     (ALTER ROLE guesthouse_app PASSWORD 'something-strong';)
    CREATE ROLE guesthouse_app LOGIN PASSWORD 'change_me';
  END IF;
END $$;

-- 2) Let it connect and see the schema.
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO guesthouse_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO guesthouse_app;

-- 3) Read + add rows on the tables the app works with.
GRANT SELECT, INSERT ON room_types, rooms, guests, bookings, stays,
                        booking_events, folio_lines TO guesthouse_app;
-- Only bookings and stays can be changed (status changes, room changes).
GRANT UPDATE ON bookings, stays TO guesthouse_app;
-- type_nights is maintained ONLY by the trigger; the app may just look.
GRANT SELECT ON type_nights, booking_balances TO guesthouse_app;
-- serial/bigserial columns use sequences; the app needs them to get new ids.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO guesthouse_app;

-- 4) Belt and braces: explicitly take away edit/delete on the append-only tables.
REVOKE UPDATE, DELETE, TRUNCATE ON booking_events, folio_lines FROM guesthouse_app;
REVOKE DELETE, TRUNCATE ON room_types, rooms, guests, bookings, stays FROM guesthouse_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON type_nights FROM guesthouse_app;

-- 5) The capacity trigger writes type_nights, which the app is NOT allowed to touch.
--    SECURITY DEFINER = "run this function with the rights of its OWNER (postgres)",
--    like a trusted clerk doing the job for you. SET search_path stops anyone
--    tricking it with a fake table of the same name in another schema.
ALTER FUNCTION bookings_sync_nights() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION bookings_log_event()   SECURITY DEFINER SET search_path = public, pg_temp;
