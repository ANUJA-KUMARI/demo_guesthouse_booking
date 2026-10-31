CREATE TABLE stays (
  id          serial PRIMARY KEY,
  booking_id  int NOT NULL REFERENCES bookings(id),
  room_id     int NOT NULL REFERENCES rooms(id),
  during      daterange NOT NULL CHECK (NOT isempty(during)),
  status      text NOT NULL DEFAULT 'CONFIRMED'
              CHECK (status IN ('CONFIRMED','ENDED','VOIDED')),
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
    WHERE (status = 'CONFIRMED')
);