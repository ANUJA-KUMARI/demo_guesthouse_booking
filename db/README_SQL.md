# Database files: run order

Run these in PowerShell from inside your `guesthouse` folder. Each one asks for your postgres password.
If you already ran `setx PGUSER postgres` and reopened PowerShell, you can drop `-U postgres`.

Already done on your PC: 001_rooms, 002_bookings, 003_type_nights, 004_stays.

## 1. New migrations (run once each, in this order)
```
psql -U postgres -d guesthouse -v ON_ERROR_STOP=1 -f db\migrations\005_events_folio.sql
psql -U postgres -d guesthouse -v ON_ERROR_STOP=1 -f db\migrations\006_roles.sql
psql -U postgres -d guesthouse -v ON_ERROR_STOP=1 -f db\migrations\007_procedures.sql
psql -U postgres -d guesthouse -v ON_ERROR_STOP=1 -f db\migrations\008_indexes.sql
```
| File | What it adds |
|---|---|
| 005_events_folio.sql | booking_events (history) and folio_lines (bill), both append-only; booking_balances view; automatic event logging |
| 006_roles.sql | low-privilege login `guesthouse_app` for the API (**change the 'change_me' password**) |
| 007_procedures.sql | check_in, change_room, check_out functions (all-or-nothing) |
| 008_indexes.sql | indexes for speed + "one active stay per booking" rule |

Expected output: `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE VIEW`, `GRANT`, `REVOKE`, `ALTER FUNCTION`, `CREATE INDEX`, `DO`.
Lines like `NOTICE: trigger ... does not exist, skipping` are normal on the first run (they come from the `DROP ... IF EXISTS` safety lines).

Set a real password for the app login (and put the same one in `api\.env` later):
```
psql -U postgres -d guesthouse -c "ALTER ROLE guesthouse_app PASSWORD 'your-strong-password';"
```

## 2. Tests (rerun any time; leaves no data behind)
```
psql -U postgres -d guesthouse -f db\tests\run_all_tests.sql
```
Expected: 17 lines starting `NOTICE:  PASS:` and finally `NOTICE:  ALL TESTS PASSED`.
If a rule is broken you'll see `ERROR:  FAIL: ...` and the script stops.

Optional, test with the app's restricted login:
```
psql -U guesthouse_app -d guesthouse -f db\tests\run_all_tests.sql
```
Same expected output.
