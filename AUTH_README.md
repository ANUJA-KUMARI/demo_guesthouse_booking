# Login & roles — how the security works (viva notes)

## 1. Three roles
| Role | How the account is made | What it can do |
|---|---|---|
| **GUEST** | Signs up on the **Sign up** page | Search rooms, book for **themselves**, see/cancel **their own** bookings, read **their own** bill |
| **MANAGER** | Created by an **admin** (Managers page) | Front desk: all bookings, walk-in bookings, check-in, room change, folio (charges/payments), checkout, add/edit/delete rooms and room types |
| **ADMIN** | First one made with `npm run create-admin` | Everything a manager can do **+** create managers |

## 2. Why a guest can never become a manager (3 locks)
1. **The signup route ignores `role`.** `POST /auth/signup` always inserts `'GUEST'`, written in the SQL itself. Sending `{"role":"ADMIN"}` changes nothing (a test proves it).
2. **Only `/admin/users` makes staff, and it checks the caller is an ADMIN** (`adminOnly` middleware → 403 for anyone else).
3. **The database double-checks** (`010_auth.sql`): a trigger refuses any MANAGER/ADMIN row unless the transaction first ran
   `set_config('app.allow_staff_create','on', true)`. Only the admin route and the create-admin script do that, and `true` means "this transaction only".
   So even a bug in the signup code could not create an admin. *(Honest limit: this protects against app bugs, not against someone who already has the database password.)*

## 3. Passwords — bcrypt
- We store `password_hash`, **never** the password. bcrypt is **one-way**, adds a random **salt** (same password → different hash), and is **slow on purpose** (cost 10), so guessing from a stolen table takes forever.
- Login says **"Wrong email or password"** for both cases, so attackers can't find out which emails exist.
- The hash is never sent to the browser.

## 4. Staying logged in — JWT in an httpOnly cookie
- After login the API creates a **JWT**: `{uid, role}` + a **signature** made with `JWT_SECRET`. Changing `GUEST` to `ADMIN` inside it breaks the signature → 401.
- It's stored in a cookie with:
  - `httpOnly` → JavaScript in the page can't read it (an XSS bug can't steal it),
  - `SameSite=Lax` → not sent by other websites' forms (blocks most CSRF),
  - `Secure` (online, https) → never sent over plain http,
  - expires after **8 hours**.
- On every request `requireAuth` verifies the signature **and reloads the user from the database**, so a deleted account stops working immediately.

## 5. 401 vs 403 vs 404
- **401** = "who are you?" (no cookie / expired / forged).
- **403** = "I know you, but you're not allowed" (guest calling a manager route).
- **404** for **another guest's booking** — we don't even admit it exists (a guest could otherwise count bookings by trying ids).

## 6. Where the checks live
```
api/src/auth.ts      requireAuth, requireRole, staff, adminOnly, assertOwnBooking
api/src/routes/*.ts  every route says who may call it, e.g. frontDesk.post('/bookings/:id/check-in', staff, ...)
web/src/auth.tsx     RequireRole only HIDES pages. The API is the real lock: never trust the browser.
```

| Endpoint | Who |
|---|---|
| `GET /room-types`, `GET /availability`, `POST /auth/signup`, `POST /auth/login` | anyone |
| `GET /auth/me`, `POST /bookings`, `GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `GET /bookings/:id/folio` | logged in (guests: own bookings only) |
| `/guests`, check-in, change-room, check-out, `/rooms/free`, `POST folio`, room & room-type create/update/delete, `GET /rooms` | MANAGER, ADMIN |
| `GET/POST /admin/users` | ADMIN |

## 7. Other protections
- **Rate limit:** 10 failed logins per 15 min per IP → 429 (stops password guessing).
- **helmet:** safe HTTP headers (no MIME sniffing, no framing, hides "Express").
- **CORS:** only the origin in `CORS_ORIGIN` may call the API with cookies.
- **SQL injection:** every query uses `$1, $2` parameters.
- **Least privilege DB login:** the API connects as `guesthouse_app`, which cannot delete users, bills or history.
- **Deleting rooms/types:** foreign keys refuse if a booking/stay still points to it → 409. History never loses its room.

## 8. Likely viva questions
- *Why not store the role in localStorage?* The browser can be edited by the user. The role lives in the database and is checked by the API every time.
- *Why a cookie and not a header token?* httpOnly cookies can't be read by JavaScript, so XSS can't steal them, and the browser sends them automatically.
- *What if JWT_SECRET leaks?* Anyone could forge tickets. Change it: every existing login becomes invalid at once.
- *How is the first admin made?* By whoever has server access, with `npm run create-admin`. After that, admins create managers in the app.
