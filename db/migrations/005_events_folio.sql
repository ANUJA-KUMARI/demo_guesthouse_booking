-- 005_events_folio.sql
-- WHAT: two "append-only" tables (history of events + the guest's bill),
--       a view that works out each booking's balance, and a trigger that
--       writes history automatically whenever a booking is created or changes status.
-- WHY:  money and history must never be silently edited. If a mistake is made,
--       you add a NEW correcting line (e.g. a CREDIT), you never change an old one.
--       That is how real accounting works and it makes every rupee traceable.

-- 1) History of everything that happened to a booking.
CREATE TABLE IF NOT EXISTS booking_events (
  id          bigserial PRIMARY KEY,                -- bigserial: history grows forever, so use a big number type
  booking_id  int  NOT NULL REFERENCES bookings(id),
  event_type  text NOT NULL CHECK (event_type IN
               ('CREATED','CANCELLED','CHECKED_IN','ROOM_CHANGED',
                'CHECKED_OUT','DATES_CHANGED','STATUS_CHANGED')),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- jsonb: flexible extra info (old/new room, dates...)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2) The folio = the guest's bill, one line per money movement.
--    amount is always positive; the KIND says which direction it goes.
CREATE TABLE IF NOT EXISTS folio_lines (
  id            bigserial PRIMARY KEY,
  booking_id    int  NOT NULL REFERENCES bookings(id),
  kind          text NOT NULL CHECK (kind IN ('CHARGE','PAYMENT','CREDIT','REFUND')),
  amount_paise  int  NOT NULL CHECK (amount_paise > 0),  -- paise = whole numbers, no rounding errors
  description   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3) One shared guard function: if anyone tries UPDATE, DELETE or TRUNCATE, refuse.
--    WHY a trigger (and not only permissions)? Triggers stop even the owner/superuser
--    by accident. Permissions (in 006) are the second lock on the same door.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed (add a correcting row instead)',
                  TG_TABLE_NAME, TG_OP;
END $$;

-- Row triggers catch UPDATE/DELETE; statement triggers catch TRUNCATE
-- (TRUNCATE skips row triggers, so it needs its own).
DROP TRIGGER IF EXISTS booking_events_no_change   ON booking_events;
DROP TRIGGER IF EXISTS booking_events_no_truncate ON booking_events;
DROP TRIGGER IF EXISTS folio_lines_no_change      ON folio_lines;
DROP TRIGGER IF EXISTS folio_lines_no_truncate    ON folio_lines;
CREATE TRIGGER booking_events_no_change   BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER booking_events_no_truncate BEFORE TRUNCATE ON booking_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER folio_lines_no_change      BEFORE UPDATE OR DELETE ON folio_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER folio_lines_no_truncate    BEFORE TRUNCATE ON folio_lines
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- 4) Balance per booking = what the guest owes.
--    CHARGE and REFUND increase what's owed (refund = money given back to them),
--    PAYMENT and CREDIT reduce it. LEFT JOIN + COALESCE gives 0 when no lines exist.
--    WHY a view instead of a "balance" column? A stored number can drift out of
--    sync; a view is always recalculated from the real lines.
CREATE OR REPLACE VIEW booking_balances AS
SELECT b.id AS booking_id,
       COALESCE(SUM(CASE WHEN f.kind IN ('CHARGE','REFUND')  THEN f.amount_paise
                         WHEN f.kind IN ('PAYMENT','CREDIT') THEN -f.amount_paise
                    END), 0)::int AS balance_paise
  FROM bookings b
  LEFT JOIN folio_lines f ON f.booking_id = b.id
 GROUP BY b.id;

-- 5) Automatic history: log CREATED on insert, and the new status on status change.
--    WHY automatic? Then nobody (app or psql) can forget to write history.
CREATE OR REPLACE FUNCTION bookings_log_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO booking_events(booking_id, event_type, details)
    VALUES (NEW.id, 'CREATED',
            jsonb_build_object('during', NEW.during::text, 'room_type_id', NEW.room_type_id));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO booking_events(booking_id, event_type, details)
    VALUES (NEW.id,
            CASE NEW.status WHEN 'CANCELLED'   THEN 'CANCELLED'
                            WHEN 'CHECKED_IN'  THEN 'CHECKED_IN'
                            WHEN 'CHECKED_OUT' THEN 'CHECKED_OUT'
                            ELSE 'STATUS_CHANGED' END,
            jsonb_build_object('from', OLD.status, 'to', NEW.status));
  ELSIF NEW.during IS DISTINCT FROM OLD.during THEN
    INSERT INTO booking_events(booking_id, event_type, details)
    VALUES (NEW.id, 'DATES_CHANGED',
            jsonb_build_object('from', OLD.during::text, 'to', NEW.during::text));
  END IF;
  RETURN NULL;   -- AFTER trigger: return value is ignored
END $$;

DROP TRIGGER IF EXISTS bookings_log_event_trg ON bookings;
CREATE TRIGGER bookings_log_event_trg
AFTER INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION bookings_log_event();
-- Note: bookings that already existed before this file get no CREATED event.
-- That's fine: history starts from the moment history-keeping was switched on.
