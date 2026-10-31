# Guest House API

Run (from the `api` folder, Postgres running, `.env` filled in):
```
npx tsx src/server.ts                 # window 1: the API on http://localhost:3000
npx tsx tests/api_smoke.ts            # window 2: every endpoint, PASS/FAIL per step
npx tsx tests/concurrency.ts          # 50 simultaneous bookings -> 5 x 201, 45 x 409
npx tsc --noEmit                      # type-check everything
```
`concurrency.ts`: set `ROOM_TYPE` to your LoadTest id (or `$env:ROOM_TYPE=2`), and change the dates (or `$env:CHECK_IN` / `$env:CHECK_OUT`) to re-run cleanly. A second run on the same dates gives 0 created, which is correct.

Money is always in **paise** (whole numbers). Dates are `YYYY-MM-DD`, stays are `[check_in, check_out)`, so the checkout day is not a night.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | /health | none | 200 | 500 |
| POST | /guests | `{name, phone, email?}` | 201 | 400 |
| GET | /guests/:id | none | 200 | 400, 404 |
| GET | /room-types | none | 200 | none |
| GET | /availability | `?check_in&check_out` | 200 (per type: capacity, max_booked, free) | 400 |
| POST | /bookings | `{guest_id, room_type_id, check_in, check_out}` | 201 | 400, 404 unknown guest/type, 409 full |
| GET | /bookings | `?status=CONFIRMED\|CHECKED_IN\|CHECKED_OUT\|CANCELLED` (optional) | 200 | 400 |
| GET | /bookings/:id | none | 200 (with stays, events, balance_paise) | 400, 404 |
| POST | /bookings/:id/cancel | none | 200 | 404, 409 not CONFIRMED |
| GET | /rooms/free | `?room_type_id&check_in&check_out` | 200 | 400 |
| POST | /bookings/:id/check-in | `{room_id}` | 200 `{stay_id}` | 400, 404, 409 wrong status / room occupied, 422 wrong room type |
| POST | /bookings/:id/change-room | `{new_room_id, on_date?}` (default today) | 200 `{stay_id}` | 400, 404, 409 room occupied / not checked in (everything rolled back), 422 other type / date outside stay |
| POST | /bookings/:id/check-out | none | 200 | 404, 409 not checked in, 422 balance not 0 |
| GET | /bookings/:id/folio | none | 200 `{lines, balance_paise}` | 404 |
| POST | /bookings/:id/folio | `{kind: CHARGE\|PAYMENT\|CREDIT\|REFUND, amount_paise, description?}` | 201 | 400, 404 |

There is no PUT or DELETE for folio lines on purpose: the bill is append-only. To correct a line, add a CREDIT or REFUND.

How errors are decided: see `src/errors.ts`. The database enforces the rules, and that file turns Postgres error codes into HTTP codes (23514→409, 23P01→409, 23503→404, 23505→409, 22007/22008/22P02→400, our RAISE messages→404/409/422).

CORS: allows the React dev server at http://localhost:5173 with no extra package.
