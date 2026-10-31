// concurrency.ts - fires 50 bookings at the SAME moment at a room type with
// capacity 5. Exactly 5 must get 201 and 45 must get 409.
// Run (API running in another window):  npm run test:concurrency
//
// Since login was added, bookings need a cookie. So we first SIGN UP a fresh
// test guest and send all 50 requests with that guest's cookie.
// We also create our own capacity-5 room type and use random far-future dates,
// so you no longer need to set ROOM_TYPE / dates by hand and can re-run freely.
import { pool } from '../src/db.js';

const API = process.env.API ?? 'http://localhost:3000';
const CAPACITY = 5;
const N = 50;

async function main() {
  const tag = Date.now().toString(36);
  const rt = await pool.query(
    'INSERT INTO room_types(name, capacity, rate_paise) VALUES ($1, $2, 100000) RETURNING id', ['Load-' + tag, CAPACITY]);
  const roomType: number = rt.rows[0].id;
  const day = new Date(Date.UTC(2200, 0, 1) + Math.floor(Math.random() * 20000) * 86400000);
  const checkIn = day.toISOString().slice(0, 10);
  const checkOut = new Date(day.getTime() + 2 * 86400000).toISOString().slice(0, 10);

  // 1) sign up a test guest and keep the login cookie
  const s = await fetch(API + '/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `load.${tag}@test.in`, password: 'LoadTest123!', full_name: 'Load Test', phone: '9000000099' }),
  });
  const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (s.status !== 201 || !cookie) throw new Error('signup failed: ' + s.status + ' ' + (await s.text()));

  // 2) 50 bookings at once
  console.log(`Room type ${roomType} (capacity ${CAPACITY}), ${checkIn} -> ${checkOut}. Sending ${N} requests...`);
  const body = JSON.stringify({ room_type_id: roomType, check_in: checkIn, check_out: checkOut });
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(API + '/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body,
      }).then((r) => r.status)));

  const created = results.filter((x) => x === 201).length;
  const conflict = results.filter((x) => x === 409).length;
  console.log({ created, conflict, other: N - created - conflict, codes: [...new Set(results)] });
  const ok = created === CAPACITY && conflict === N - CAPACITY;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
  await pool.end();
}

main();
