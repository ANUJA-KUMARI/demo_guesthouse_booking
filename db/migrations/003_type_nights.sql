CREATE TABLE type_nights (
  room_type_id int  NOT NULL REFERENCES room_types(id),
  night        date NOT NULL,
  booked       int  NOT NULL DEFAULT 0,
  capacity     int  NOT NULL,
  PRIMARY KEY (room_type_id, night),
  CHECK (booked >= 0 AND booked <= capacity)
);

CREATE FUNCTION bookings_sync_nights() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 1. Give back the old nights (cancel, date change, delete)
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.status <> 'CANCELLED' THEN
    PERFORM 1 FROM type_nights
     WHERE room_type_id = OLD.room_type_id
       AND night >= lower(OLD.during) AND night < upper(OLD.during)
     ORDER BY night FOR UPDATE;
    UPDATE type_nights SET booked = booked - 1
     WHERE room_type_id = OLD.room_type_id
       AND night >= lower(OLD.during) AND night < upper(OLD.during);
  END IF;

  -- 2. Take the new nights
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status <> 'CANCELLED' THEN
    INSERT INTO type_nights (room_type_id, night, capacity)
    SELECT NEW.room_type_id, d::date, rt.capacity
      FROM generate_series(lower(NEW.during), upper(NEW.during) - 1, interval '1 day') AS d
      JOIN room_types rt ON rt.id = NEW.room_type_id
    ON CONFLICT DO NOTHING;

    PERFORM 1 FROM type_nights
     WHERE room_type_id = NEW.room_type_id
       AND night >= lower(NEW.during) AND night < upper(NEW.during)
     ORDER BY night FOR UPDATE;
    UPDATE type_nights SET booked = booked + 1
     WHERE room_type_id = NEW.room_type_id
       AND night >= lower(NEW.during) AND night < upper(NEW.during);
  END IF;

  RETURN NULL;
END $$;

CREATE TRIGGER bookings_nights_trg
AFTER INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION bookings_sync_nights();