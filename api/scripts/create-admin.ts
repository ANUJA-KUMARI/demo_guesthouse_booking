// create-admin.ts - make the FIRST admin account (run once, from the api folder):
//   npm run create-admin -- admin@guesthouse.in "Str0ngPassword!" "Rushil Sharma"
// WHY a script? Signup only ever makes guests, and only an admin can make staff.
// Someone has to be first: the person with access to the server (you).
import { pool } from '../src/db.js';
import { withTransaction } from '../src/tx.js';
import { hashPassword, requiredText, validEmail, validPassword } from '../src/passwords.js';

async function main() {
  const [emailArg, passwordArg, ...nameParts] = process.argv.slice(2);
  try {
    const email = validEmail(emailArg);
    const password = validPassword(passwordArg);
    const name = requiredText(nameParts.join(' '), 'name');
    const hash = await hashPassword(password);
    const r = await withTransaction(async (c) => {
      await c.query("SELECT set_config('app.allow_staff_create', 'on', true)");   // see 010_auth.sql
      return c.query(
        `INSERT INTO users(email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'ADMIN') RETURNING id, email, role`, [email, hash, name]);
    });
    console.log('Admin created:', r.rows[0]);
  } catch (e: any) {
    console.error('Could not create admin:', e.code === '23505' ? 'that email already has an account' : e.message);
    console.error('Usage: npm run create-admin -- <email> <password> <full name>');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
