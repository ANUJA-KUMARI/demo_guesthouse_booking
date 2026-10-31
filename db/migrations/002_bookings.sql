CREATE TABLE guests (
  id     serial PRIMARY KEY,
  name   text NOT NULL,
  phone  text NOT NULL,
  email  text
);
CREATE TABLE bookings (
  id           serial PRIMARY KEY,
  guest_id     int NOT NULL REFERENCES guests(id),
  room_type_id int NOT NULL REFERENCES room_types(id),
  during       daterange NOT NULL,
  status       text NOT NULL DEFAULT 'CONFIRMED'
               CHECK (status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (lower_inc(during) AND NOT upper_inc(during)),
  CHECK (NOT isempty(during))
);




