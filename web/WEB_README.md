# Guest House – React screens

## Run
1. Window 1 (in `api`): `npx tsx src/server.ts` → API on http://localhost:3000
2. Window 2 (in `web`): `npm run dev` → open http://localhost:5173
   (must be port 5173: the API only allows that origin. If Vite says 5174, close the other Vite window.)
3. `npm run build` type-checks everything and makes a production build.

The API address lives in one place: `src/api.ts` (`API_URL`). Money is stored as paise and shown as ₹ with 2 decimals (`src/format.ts`).

## Screens
| # | URL | What it does | Endpoints |
|---|---|---|---|
| 1 | /search | Pick dates, see each room type's capacity, free rooms and rate; **Book** opens the form prefilled | GET /availability |
| 2 | /book | Create the guest, then the booking. Shows the booking id on 201, "sold out" on 409, form problem on 400 | GET /room-types, POST /guests, POST /bookings |
| 3 | /bookings, /bookings/:id | List with status filter; detail shows dates, status, stays (room history), events timeline, balance, Cancel (409 if not CONFIRMED) | GET /bookings, GET /bookings/:id, POST /bookings/:id/cancel |
| 4 | /check-in | Confirmed bookings → choose one → free rooms of its type for its dates → check in (409 if the room was just taken) | GET /bookings?status=CONFIRMED, GET /rooms/free, POST /bookings/:id/check-in |
| 5 | /rooms | Checked-in guests with current room; move to another free room of the same type from a date (default today, kept inside the stay). 409 = nothing changed (rolled back) | GET /bookings?status=CHECKED_IN, GET /bookings/:id, GET /rooms/free, POST /bookings/:id/change-room |
| 6 | /folio, /folio/:id | Bill lines and balance; add CHARGE/PAYMENT/CREDIT/REFUND in rupees (sent as whole paise); Check out (422 while balance ≠ ₹0.00) | GET/POST /bookings/:id/folio, POST /bookings/:id/check-out |

## Files
- `src/main.tsx` – starts React with the router · `src/App.tsx` – nav bar + routes
- `src/api.ts` – base URL, types, one fetch helper (throws `ApiError` with `status` + message)
- `src/format.ts` – ₹ formatting, rupees→paise, local dates · `src/components.tsx` – Loading, Message, StatusBadge
- `src/pages/*.tsx` – one file per screen · `src/styles.css` – all styling
