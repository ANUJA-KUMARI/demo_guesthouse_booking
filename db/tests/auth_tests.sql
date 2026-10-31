-- auth_tests.sql - checks for 010_auth.sql. Everything runs inside
-- BEGIN ... ROLLBACK, so it leaves no rows behind.
-- Run:  psql -U postgres -d guesthouse -f db\tests\auth_tests.sql
BEGIN;
DO $$
DECLARE g int; ok boolean;
BEGIN
  INSERT INTO guests(name, phone) VALUES ('Auth Test', '9000000001') RETURNING id INTO g;

  -- 1) a normal GUEST account is allowed
  INSERT INTO users(email, password_hash, full_name, guest_id) VALUES ('t1@test.in', 'x', 'T1', g);
  RAISE NOTICE 'PASS: guest account created';

  -- 2) a MANAGER without the session switch is refused
  ok := false;
  BEGIN
    INSERT INTO users(email, password_hash, full_name, role) VALUES ('m@test.in', 'x', 'M', 'MANAGER');
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: manager created without switch'; END IF;
  RAISE NOTICE 'PASS: staff account refused without app.allow_staff_create';

  -- 3) turning a guest into an ADMIN with UPDATE is refused too
  ok := false;
  BEGIN
    UPDATE users SET role = 'ADMIN' WHERE email = 't1@test.in';
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: guest promoted to admin'; END IF;
  RAISE NOTICE 'PASS: promoting a guest refused';

  -- 4) same email in different capitals is a duplicate
  ok := false;
  BEGIN
    INSERT INTO users(email, password_hash, full_name, guest_id)
    VALUES ('T1@TEST.IN', 'x', 'T1', NULL);
  EXCEPTION WHEN check_violation OR unique_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: upper-case duplicate email accepted'; END IF;
  RAISE NOTICE 'PASS: emails must be lower-case and unique';

  -- 5) with the switch ON (what the admin endpoint does) a MANAGER is allowed
  PERFORM set_config('app.allow_staff_create', 'on', true);
  INSERT INTO users(email, password_hash, full_name, role) VALUES ('m@test.in', 'x', 'M', 'MANAGER');
  RAISE NOTICE 'PASS: manager created when admin switch is on';

  RAISE NOTICE 'ALL AUTH TESTS PASSED';
END $$;
ROLLBACK;
