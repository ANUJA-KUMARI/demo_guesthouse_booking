CREATE TABLE room_types (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  capacity  int  NOT NULL CHECK (capacity > 0),
  rate_paise int NOT NULL CHECK (rate_paise >= 0) --using only whole numbers to avoid floating point issues
);
CREATE TABLE rooms (
  id           serial PRIMARY KEY,
  room_number  text NOT NULL UNIQUE,
  room_type_id int  NOT NULL REFERENCES room_types(id)--REFERENCES means a room can't point to a type that doesn't exist.
);

