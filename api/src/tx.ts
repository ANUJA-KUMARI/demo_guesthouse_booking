// tx.ts - the "transaction helper".
//
// WHY: check-in, room change and check-out each change SEVERAL rows
// (a stay, the booking status, an event...). Either ALL of that must happen
// or NONE of it. A transaction gives us exactly that:
//   BEGIN    -> "start a bundle of work"
//   COMMIT   -> "save the whole bundle"
//   ROLLBACK -> "throw the whole bundle away" (used when anything fails)
//
// WHY a dedicated client? pool.query() may send each query down a DIFFERENT
// connection. BEGIN on one connection and UPDATE on another would not be in
// the same transaction. So we borrow ONE connection, do everything on it,
// then give it back with release().
import type { PoolClient } from 'pg';
import { pool } from './db.js';

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // Something failed: undo every change made since BEGIN, then pass the
    // error on so the error handler can turn it into a 409/422/404...
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // ALWAYS give the connection back, or the pool runs dry and the API hangs.
    client.release();
  }
}
