// server.ts - starts the API and plugs in every group of routes.
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pool } from './db.js';
import { errorHandler } from './errors.js';
import { auth } from './routes/auth.js';
import { admin } from './routes/admin.js';
import { guests } from './routes/guests.js';
import { roomTypes } from './routes/roomTypes.js';
import { availability } from './routes/availability.js';
import { bookings } from './routes/bookings.js';
import { frontDesk } from './routes/frontDesk.js';
import { folio } from './routes/folio.js';

const app = express();

// Behind nginx / Render the real visitor IP is in X-Forwarded-For.
// TRUST_PROXY=1 tells Express to use it (the login rate limit needs real IPs).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

// helmet = a set of safe HTTP headers (no sniffing, no framing, hide "X-Powered-By: Express"...).
app.use(helmet());
app.use(express.json({ limit: '100kb' }));   // refuse giant bodies
app.use(cookieParser());                     // fills req.cookies (our login cookie)

// CORS: which OTHER websites may call this API with the login cookie.
// With the /api proxy (Vite in dev, nginx in Docker) the browser sees one
// origin and CORS isn't even needed. It matters only if web and API run on
// different addresses. CORS_ORIGIN can hold several, comma-separated.
const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));   // credentials = allow cookies

app.get('/health', async (_req, res) => {
  const r = await pool.query('SELECT now() AS time, current_user AS db_user');
  res.json({ ok: true, ...r.rows[0] });
});

app.use(auth, admin, guests, roomTypes, availability, bookings, frontDesk, folio);

// Unknown URL -> 404 JSON (instead of Express's HTML page).
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
// MUST be last: catches every error thrown in the routes above.
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
