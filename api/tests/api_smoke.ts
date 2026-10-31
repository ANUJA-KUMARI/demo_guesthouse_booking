// api_smoke.ts - walks through EVERY endpoint in a realistic order and prints
// PASS/FAIL per step. Run with the server already running in another window:
//   npx tsx tests/api_smoke.ts
//
// It creates its own test room type (capacity 2) with 3 rooms, using the
// same guesthouse_app login as the API, and uses random far-future dates so
// it can be re-run any number of times without clashing with old data.
//
// LOGIN: each "actor" (admin, manager, guest1, guest2, nobody) keeps its own
// cookie, like 4 different browsers. call(..., who) sends that actor's cookie.
import { pool } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';

const API = 'http://localhost:3000';
let passed = 0, failed = 0;

type Actor = { cookie: string };
const nobody: Actor = { cookie: '' };
let staffActor: Actor = nobody;   // who the old (pre-login) tests act as: the manager

async function call(method: string, path: string, body?: unknown, who: Actor = staffActor) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who.cookie) headers.Cookie = who.cookie;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(API + path, init);
  // Remember the login cookie the server sets (name=value part only).
  const set = r.headers.get('set-cookie');
  if (set) who.cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

function check(name: string, ok: boolean, info?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(info)}`);
}

// Add n days to 'YYYY-MM-DD'
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function main() {
  // --- setup: fresh room type + 3 rooms ---
  const tag = Date.now().toString(36);
  const rt = await pool.query(
    'INSERT INTO room_types(name, capacity, rate_paise) VALUES ($1, 2, 300000) RETURNING id', ['Smoke-' + tag]);
  const typeId: number = rt.rows[0].id;
  const rooms: number[] = [];
  for (const n of ['A', 'B', 'C']) {
    const r = await pool.query('INSERT INTO rooms(room_number, room_type_id) VALUES ($1, $2) RETURNING id',
                               [`S${tag}-${n}`, typeId]);
    rooms.push(r.rows[0].id);
  }
  const [roomA, roomB, roomC] = rooms as [number, number, number];
  const ci = addDays('2100-01-01', Math.floor(Math.random() * 20000)); // random date in 2100s
  const co = addDays(ci, 3);
  console.log(`Test room type ${typeId}, rooms ${rooms.join(',')}, dates ${ci} -> ${co}\n`);

  let r = await call('GET', '/health');
  check('GET /health is ok as guesthouse_app', r.status === 200 && r.json.db_user === 'guesthouse_app', r);

  // ================= AUTH =================
  // An admin made the same way "npm run create-admin" does it.
  const pw = 'Passw0rd!' + tag;
  await pool.query('BEGIN');
  await pool.query("SELECT set_config('app.allow_staff_create', 'on', true)");
  await pool.query(`INSERT INTO users(email, password_hash, full_name, role) VALUES ($1, $2, 'Smoke Admin', 'ADMIN')`,
                   [`admin.${tag}@smoke.test`, await hashPassword(pw)]);
  await pool.query('COMMIT');
  const adminA: Actor = { cookie: '' }, managerA: Actor = { cookie: '' };
  const guest1A: Actor = { cookie: '' }, guest2A: Actor = { cookie: '' };

  r = await call('GET', '/bookings', undefined, nobody);
  check('no cookie: GET /bookings -> 401', r.status === 401, r);
  r = await call('GET', '/auth/me', undefined, { cookie: 'gh_token=forged.token.value' });
  check('forged cookie: GET /auth/me -> 401', r.status === 401, r);

  r = await call('POST', '/auth/signup', { email: `G1.${tag}@smoke.test`, password: pw, full_name: 'Guest One',
                                           phone: '9000000011', role: 'ADMIN' }, guest1A);
  check('signup with role:ADMIN still creates a GUEST', r.status === 201 && r.json.user?.role === 'GUEST'
        && r.json.user.guest_id && guest1A.cookie.startsWith('gh_token='), r);
  r = await call('POST', '/auth/signup', { email: `g2.${tag}@smoke.test`, password: pw, full_name: 'Guest Two', phone: '9000000012' }, guest2A);
  check('signup guest2 -> 201', r.status === 201, r);
  r = await call('POST', '/auth/signup', { email: `g2.${tag}@SMOKE.test`, password: pw, full_name: 'Dup', phone: '1' }, nobody);
  check('signup same email (other capitals) -> 409', r.status === 409, r);
  r = await call('POST', '/auth/signup', { email: `x.${tag}@smoke.test`, password: 'short', full_name: 'X', phone: '1' }, nobody);
  check('signup short password -> 400', r.status === 400, r);
  r = await call('GET', '/auth/me', undefined, guest1A);
  check('GET /auth/me as guest1 -> GUEST', r.status === 200 && r.json.user.role === 'GUEST', r);

  r = await call('POST', '/auth/login', { email: `admin.${tag}@smoke.test`, password: 'wrong-password' }, adminA);
  check('login wrong password -> 401', r.status === 401 && !adminA.cookie, r);
  r = await call('POST', '/auth/login', { email: `ADMIN.${tag}@smoke.test`, password: pw }, adminA);
  check('admin login (any capitals) -> 200 ADMIN', r.status === 200 && r.json.user.role === 'ADMIN' && !r.json.user.password_hash, r);

  r = await call('POST', '/admin/users', { email: `mgr.${tag}@smoke.test`, password: pw, full_name: 'Smoke Manager' }, adminA);
  check('admin creates a manager -> 201 MANAGER', r.status === 201 && r.json.role === 'MANAGER', r);
  r = await call('GET', '/admin/users', undefined, adminA);
  check('admin lists staff incl. new manager', r.status === 200 && r.json.some((u: any) => u.email === `mgr.${tag}@smoke.test`), r.status);
  r = await call('POST', '/admin/users', { email: `evil.${tag}@smoke.test`, password: pw, full_name: 'Evil' }, guest1A);
  check('guest cannot create a manager -> 403', r.status === 403, r);
  r = await call('POST', '/auth/login', { email: `mgr.${tag}@smoke.test`, password: pw }, managerA);
  check('manager login -> 200 MANAGER', r.status === 200 && r.json.user.role === 'MANAGER', r);
  r = await call('GET', '/admin/users', undefined, managerA);
  check('manager cannot use admin routes -> 403', r.status === 403, r);
  staffActor = managerA;   // everything below without an explicit actor = the manager

  // guest -> 403 on every manager route
  const managerRoutes: [string, string, unknown?][] = [
    ['POST', '/guests', { name: 'x', phone: '1' }], ['POST', `/bookings/1/check-in`, { room_id: roomA }],
    ['POST', `/bookings/1/check-out`], ['POST', `/bookings/1/change-room`, { new_room_id: roomA }],
    ['POST', `/bookings/1/folio`, { kind: 'PAYMENT', amount_paise: 100 }], ['GET', `/rooms/free?room_type_id=${typeId}&check_in=${ci}&check_out=${co}`],
    ['POST', '/room-types', { name: 'Hack', capacity: 1, rate_paise: 1 }], ['DELETE', `/rooms/${roomA}`], ['GET', '/rooms'],
  ];
  const codes: number[] = [];
  for (const [m, p, b] of managerRoutes) codes.push((await call(m, p, b, guest1A)).status);
  check(`guest gets 403 on ${managerRoutes.length} manager routes`, codes.every((c) => c === 403), codes);

  // Guest books for THEMSELVES: guest_id in the body is ignored.
  r = await call('GET', '/auth/me', undefined, guest2A);
  const g2id = r.json.user.guest_id;
  r = await call('POST', '/bookings', { guest_id: g2id, room_type_id: typeId, check_in: addDays(ci, 40), check_out: addDays(ci, 41) }, guest1A);
  const g1Booking = r.json.id;
  r = await call('GET', `/bookings/${g1Booking}`, undefined, guest1A);
  check('guest booking always uses own guest_id (body ignored)', r.status === 200 && r.json.guest_id !== g2id && r.json.guest_name === 'Guest One', r);
  r = await call('GET', `/bookings/${g1Booking}`, undefined, guest2A);
  check("guest2 cannot see guest1's booking -> 404", r.status === 404, r);
  r = await call('GET', `/bookings/${g1Booking}/folio`, undefined, guest2A);
  check("guest2 cannot see guest1's folio -> 404", r.status === 404, r);
  r = await call('POST', `/bookings/${g1Booking}/cancel`, undefined, guest2A);
  check("guest2 cannot cancel guest1's booking -> 404", r.status === 404, r);
  r = await call('GET', '/bookings', undefined, guest2A);
  check('guest2 "my bookings" does not list it', r.status === 200 && !r.json.some((b: any) => b.id === g1Booking), r.json.length);
  r = await call('GET', '/bookings', undefined, guest1A);
  check('guest1 "my bookings" lists it', r.json.some((b: any) => b.id === g1Booking), r.json.length);
  r = await call('GET', `/bookings/${g1Booking}/folio`, undefined, guest1A);
  check('guest1 can read own folio', r.status === 200 && r.json.balance_paise === 0, r);
  r = await call('POST', `/bookings/${g1Booking}/cancel`, undefined, guest1A);
  check('guest1 cancels own CONFIRMED booking -> 200', r.status === 200 && r.json.status === 'CANCELLED', r);
  r = await call('GET', '/bookings', undefined, managerA);
  check('manager sees all bookings incl. guest1\'s', r.status === 200 && r.json.some((b: any) => b.id === g1Booking), r.status);

  // Room & room-type management (manager)
  r = await call('POST', '/room-types', { name: 'Tmp-' + tag, capacity: 1, rate_paise: 1000 });
  const tmpType = r.json.id;
  check('manager adds a room type -> 201', r.status === 201, r);
  r = await call('PUT', `/room-types/${tmpType}`, { name: 'Tmp2-' + tag, capacity: 2, rate_paise: 2000 });
  check('manager edits a room type -> 200', r.status === 200 && r.json.capacity === 2, r);
  r = await call('POST', '/rooms', { room_number: `T${tag}`, room_type_id: tmpType });
  const tmpRoom = r.json.id;
  check('manager adds a room -> 201', r.status === 201, r);
  r = await call('POST', '/rooms', { room_number: `T${tag}`, room_type_id: tmpType });
  check('duplicate room number -> 409', r.status === 409, r);
  r = await call('DELETE', `/room-types/${tmpType}`);
  check('delete room type that still has rooms -> 409', r.status === 409, r);
  r = await call('DELETE', `/rooms/${tmpRoom}`);
  check('delete unused room -> 204', r.status === 204, r);
  r = await call('DELETE', `/room-types/${tmpType}`);
  check('delete now-unused room type -> 204', r.status === 204, r);

  r = await call('POST', '/auth/logout', undefined, guest2A);
  r = await call('GET', '/auth/me', undefined, guest2A);
  check('after logout -> 401', r.status === 401, r);
  console.log('');

  r = await call('POST', '/guests', { name: 'Smoke Guest', phone: '9000000000' });
  check('POST /guests -> 201', r.status === 201 && r.json.id, r);
  const guest = r.json.id;
  r = await call('POST', '/guests', { name: '' });
  check('POST /guests missing fields -> 400', r.status === 400, r);
  r = await call('GET', `/guests/${guest}`);
  check('GET /guests/:id -> 200', r.status === 200 && r.json.name === 'Smoke Guest', r);
  r = await call('GET', '/guests/999999999');
  check('GET /guests/unknown -> 404', r.status === 404, r);

  r = await call('GET', '/room-types');
  check('GET /room-types lists test type', r.status === 200 && r.json.some((t: any) => t.id === typeId && t.rooms === 3), r);

  r = await call('GET', `/availability?check_in=${ci}&check_out=${co}`);
  let av = r.json.room_types?.find((t: any) => t.room_type_id === typeId);
  check('GET /availability -> free 2 before booking', r.status === 200 && av?.free === 2, r);
  r = await call('GET', `/availability?check_in=${co}&check_out=${ci}`);
  check('GET /availability bad dates -> 400', r.status === 400, r);
  r = await call('GET', `/availability?check_in=2026-02-30&check_out=2026-03-02`);
  check('GET /availability impossible date -> 400', r.status === 400, r);

  const nb = { guest_id: guest, room_type_id: typeId, check_in: ci, check_out: co };
  r = await call('POST', '/bookings', nb);
  check('POST /bookings #1 -> 201', r.status === 201, r);
  const b1 = r.json.id;
  r = await call('POST', '/bookings', nb);
  check('POST /bookings #2 -> 201', r.status === 201, r);
  const b2 = r.json.id;
  r = await call('POST', '/bookings', nb);
  check('POST /bookings #3 on full type -> 409', r.status === 409, r);
  r = await call('POST', '/bookings', { ...nb, guest_id: 999999999 });
  check('POST /bookings unknown guest -> 404', r.status === 404, r);
  r = await call('GET', `/availability?check_in=${ci}&check_out=${co}`);
  av = r.json.room_types?.find((t: any) => t.room_type_id === typeId);
  check('GET /availability -> free 0 after 2 bookings', av?.free === 0 && av?.max_booked === 2, r);

  r = await call('GET', `/rooms/free?room_type_id=${typeId}&check_in=${ci}&check_out=${co}`);
  check('GET /rooms/free -> 3 rooms before check-in', r.status === 200 && r.json.length === 3, r);

  r = await call('POST', `/bookings/${b1}/check-in`, { room_id: roomA });
  check('POST check-in booking1 -> room A 200', r.status === 200 && r.json.stay_id, r);
  r = await call('POST', `/bookings/${b1}/check-in`, { room_id: roomA });
  check('POST check-in again -> 409 (already CHECKED_IN)', r.status === 409, r);
  r = await call('POST', `/bookings/${b2}/check-in`, { room_id: roomA });
  check('POST check-in booking2 into occupied A -> 409', r.status === 409 && /occupied/.test(r.json.error), r);
  r = await call('POST', `/bookings/${b2}/check-in`, { room_id: roomB });
  check('POST check-in booking2 -> room B 200', r.status === 200, r);
  r = await call('GET', `/rooms/free?room_type_id=${typeId}&check_in=${ci}&check_out=${co}`);
  check('GET /rooms/free -> only C left', r.json.length === 1 && r.json[0].id === roomC, r);

  const mid = addDays(ci, 1);
  r = await call('POST', `/bookings/${b1}/change-room`, { new_room_id: roomB, on_date: mid });
  check('POST change-room to taken B -> 409', r.status === 409, r);
  r = await call('GET', `/bookings/${b1}`);
  const active = r.json.stays?.filter((s: any) => s.status === 'CONFIRMED');
  check('...rollback: booking1 still only in room A', active?.length === 1 && active[0].room_id === roomA && r.json.stays.length === 1, r.json.stays);
  r = await call('POST', `/bookings/${b1}/change-room`, { new_room_id: roomC, on_date: addDays(co, 5) });
  check('POST change-room date outside stay -> 422', r.status === 422, r);
  r = await call('POST', `/bookings/${b1}/change-room`, { new_room_id: roomC, on_date: mid });
  check('POST change-room to C -> 200', r.status === 200, r);
  r = await call('GET', `/bookings/${b1}`);
  check('GET /bookings/:id shows ENDED A + CONFIRMED C + events',
    r.json.stays?.length === 2 && r.json.stays[0].status === 'ENDED' && r.json.stays[1].room_id === roomC
    && r.json.events?.some((e: any) => e.event_type === 'ROOM_CHANGED'), r.json);

  r = await call('POST', `/bookings/${b1}/folio`, { kind: 'CHARGE', amount_paise: 900000, description: '3 nights' });
  check('POST folio CHARGE -> 201', r.status === 201, r);
  const lineId = r.json.id;
  r = await call('POST', `/bookings/${b1}/folio`, { kind: 'GIFT', amount_paise: 100 });
  check('POST folio bad kind -> 400', r.status === 400, r);
  r = await call('POST', `/bookings/${b1}/folio`, { kind: 'CHARGE', amount_paise: -5 });
  check('POST folio negative amount -> 400', r.status === 400, r);
  r = await call('POST', `/bookings/${b1}/folio`, { kind: 'CHARGE', amount_paise: 10.5 });
  check('POST folio decimal amount -> 400', r.status === 400, r);
  r = await call('GET', `/bookings/${b1}/folio`);
  check('GET folio -> balance 900000', r.status === 200 && r.json.balance_paise === 900000 && r.json.lines.length === 1, r);

  r = await call('POST', `/bookings/${b1}/check-out`);
  check('POST check-out with balance -> 422', r.status === 422, r);
  r = await call('POST', `/bookings/${b1}/folio`, { kind: 'PAYMENT', amount_paise: 900000, description: 'UPI' });
  check('POST folio PAYMENT -> 201', r.status === 201, r);
  r = await call('POST', `/bookings/${b1}/check-out`);
  check('POST check-out balance 0 -> 200', r.status === 200, r);
  r = await call('GET', `/bookings/${b1}`);
  check('GET booking1 is CHECKED_OUT, no active stay', r.json.status === 'CHECKED_OUT'
    && !r.json.stays.some((s: any) => s.status === 'CONFIRMED'), r.json);
  r = await call('POST', `/bookings/${b1}/cancel`);
  check('POST cancel a CHECKED_OUT booking -> 409', r.status === 409, r);

  // cancel flow: book on other dates, cancel, cancel again, space returns
  const ci2 = addDays(co, 10), co2 = addDays(co, 12);
  r = await call('POST', '/bookings', { ...nb, check_in: ci2, check_out: co2 });
  const b3 = r.json.id;
  r = await call('POST', `/bookings/${b3}/cancel`);
  check('POST cancel CONFIRMED -> 200', r.status === 200 && r.json.status === 'CANCELLED', r);
  r = await call('POST', `/bookings/${b3}/cancel`);
  check('POST cancel again -> 409', r.status === 409, r);
  r = await call('POST', '/bookings/999999999/cancel');
  check('POST cancel unknown -> 404', r.status === 404, r);
  r = await call('GET', `/availability?check_in=${ci2}&check_out=${co2}`);
  av = r.json.room_types?.find((t: any) => t.room_type_id === typeId);
  check('...cancel gave the nights back (free 2)', av?.free === 2, av);
  r = await call('POST', `/bookings/${b3}/check-in`, { room_id: roomA });
  check('POST check-in a CANCELLED booking -> 409', r.status === 409, r);

  r = await call('GET', '/bookings?status=CANCELLED');
  check('GET /bookings?status=CANCELLED includes it', r.status === 200 && r.json.some((b: any) => b.id === b3), r.status);
  r = await call('GET', '/bookings?status=NOPE');
  check('GET /bookings bad status -> 400', r.status === 400, r);

  // append-only: no endpoint can edit/delete a bill line
  r = await call('PUT', `/bookings/${b1}/folio/${lineId}`, { amount_paise: 1 });
  const r2 = await call('DELETE', `/bookings/${b1}/folio/${lineId}`);
  check('PUT/DELETE folio line not exposed -> 404', r.status === 404 && r2.status === 404, [r, r2]);
  // and even the DB login itself is refused
  let refused = false;
  try { await pool.query('DELETE FROM folio_lines WHERE id = $1', [lineId]); } catch (e: any) { refused = e.code === '42501'; }
  check('guesthouse_app DELETE on folio_lines refused by DB', refused);

  // Room in use (has stays) can't be deleted; capacity can't drop below bookings.
  r = await call('DELETE', `/rooms/${roomA}`);
  check('delete room with stay history -> 409', r.status === 409, r);
  r = await call('PUT', `/room-types/${typeId}`, { name: 'Smoke-' + tag, capacity: 1, rate_paise: 300000 });
  check('lower capacity below booked nights -> 409', r.status === 409, r);

  console.log(`\n${passed} passed, ${failed} failed -> ${failed === 0 ? 'ALL API TESTS PASSED' : 'SOME TESTS FAILED'}`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}

main();
