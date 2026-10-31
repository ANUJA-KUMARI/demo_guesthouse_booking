# Seed data + speed check (step 9)

## What these files are
| File | What it does |
|---|---|
| `009_seed.sql` | Fills the DB with a full year (2026) of demo data. |
| `perf_check.sql` | Counts rows, checks the data is consistent, and runs `EXPLAIN (ANALYZE, BUFFERS)` on the queries our API uses. |

## Why we do this
With 5 rows every query is fast and every rule "works". A real guest house has thousands of rows.
The seed proves two things:
1. **The rules hold at scale.** Every booking goes through the real capacity trigger, the stays
   exclusion constraint and the `check_in` / `check_out` functions. Nothing is switched off.
   If a booking would overbook a room type, the database refuses it and the seed just skips it.
2. **The indexes are actually used**, so screens stay fast as data grows.

## What the seed creates
- 6 room types (Standard Single ... Executive Suite), 40 rooms (numbers 201-704)
- 1500 guests
- 4500 booking *attempts* in 2026, about 3800 succeed, the rest are skipped as overbookings
- "Today" for the seed is fixed at **2026-10-29**:
  - stays that ended before it are **checked in, billed, paid and checked out**
  - stays around it are **CHECKED_IN** with a half payment (balance still owed)
  - later bookings stay **CONFIRMED**; 1 in 10 bookings is **CANCELLED**
- folio lines (CHARGE, PAYMENT, sometimes a 10% CREDIT) and booking events (written by the trigger)

Total: about 26,000 rows. It is **deterministic** (no `random()`), so you get the same data every time.
It is **safe to re-run**: if it is already loaded it prints "Seed already loaded" and does nothing.
It takes about 20-40 seconds, because every booking runs through the triggers one by one.

## How to run it (PowerShell)
```powershell
cd "C:\Users\Lenovo\Documents\FSD PROJECT\guesthouse"
psql -U postgres -d guesthouse -f db\seed\009_seed.sql
psql -U postgres -d guesthouse -f db\seed\perf_check.sql > db\seed\perf_result.txt
notepad db\seed\perf_result.txt
```
Expected from the seed: `NOTICE: Seed done: 3819 bookings created, 681 skipped (would overbook)`.
Run the seed as **postgres** (not guesthouse_app): it ends with `ANALYZE`, which needs the owner.

Then run the tests again. They still pass on a seeded DB because they use their own TEST_ rows
and roll everything back:
```powershell
psql -U postgres -d guesthouse -f db\tests\run_all_tests.sql
```

## Reading the perf_check output
**Row counts and sanity checks:** the three sanity numbers (`over_capacity_nights`,
`counter_mismatches`, `checked_out_with_balance`) must all be **0**.

**EXPLAIN (ANALYZE, BUFFERS)** shows the plan PostgreSQL used and what really happened. Read it from the
most indented line upwards.
- `Index Scan using X` / `Index Only Scan` / `Bitmap Index Scan on X`: it used index X and jumped straight
  to the rows. This is what we want for "one booking", "this guest" and "these dates" lookups.
- `Seq Scan on X`: it read the whole table. That is **fine for tiny tables** (room_types has 7 rows, rooms 41)
  and for queries that return a big share of the table (the bookings list). For tiny tables reading 1 page
  is cheaper than using an index.
- `actual time=0.01..0.05 rows=3`: milliseconds to first row..last row, and how many rows came out.
- `Rows Removed by Filter`: rows it read and threw away. A big number here on a large table hints at a missing index.
- `Buffers: shared hit=4`: pages (8 kB each) read from memory. "read=" would mean from disk.
- `Execution Time`: the total. Anything under a few ms is excellent.

### What we got on the test machine
| Query (API route) | Plan | Time |
|---|---|---|
| GET /availability | Bitmap Index Scan on `type_nights_pkey` | 0.11 ms |
| GET /bookings/:id | Index Scan on `bookings_pkey` | 0.08 ms |
| stays of a booking | Index Scan on `stays_booking_idx` | 0.03 ms |
| events of a booking | Index Scan on `booking_events_booking_idx` | 0.02 ms |
| balance view | Index Only Scan `bookings_pkey` + `folio_lines_booking_idx` | 0.02 ms |
| folio lines | Index Scan on `folio_lines_booking_idx` | 0.01 ms |
| GET /rooms/free | Index Only Scan on the stays **exclusion constraint's gist index** | 0.6 ms |
| GET /bookings?status= | Seq Scan (returns ~600 of 3800 rows, so that is the right choice) | 1.1 ms |
| bookings of a guest | Bitmap Index Scan on `bookings_guest_idx` | 0.02 ms |
| bookings overlapping dates | Bitmap Index Scan on `bookings_during_idx` (gist) | 0.05 ms |

Nice talking point for the viva: the exclusion constraint on stays doesn't just block double-booking a room,
its gist index also makes the "free rooms" search fast.

## Notes
- Skipped bookings still use up an id from the sequence, so booking ids have gaps. That's normal.
- To start fresh: `dropdb -U postgres guesthouse`, `createdb -U postgres guesthouse`, then run migrations 001-008 and the seed.
  You can't "delete" seed rows because booking_events/folio_lines are append-only (that's the design!).
