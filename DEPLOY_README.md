# Deploying the Guest House app

## A. Run everything with Docker on Windows (one command)
1. Install **Docker Desktop** for Windows (it uses WSL 2; accept that during install) and start it.
2. In PowerShell, in the project root (`guesthouse`, where `docker-compose.yml` is):
   ```powershell
   Copy-Item .env.example .env
   notepad .env        # change all 3 passwords/secrets; LOAD_SEED=true for demo data
   docker compose up --build
   ```
   The first start builds the images and runs every migration (`db/docker-init/01_migrate.sh`). Wait for `database ready` and `API running`.
3. Create the first admin (in a **second** PowerShell window):
   ```powershell
   docker compose exec api npm run create-admin -- admin@guesthouse.in "YourStrongPass1" "Rushil Sharma"
   ```
4. Open **http://localhost:8080** → log in as the admin → create a manager on the *Managers* page.

Useful commands:
| Command | What it does |
|---|---|
| `docker compose up -d` | start in the background |
| `docker compose logs -f api` | watch API logs |
| `docker compose down` | stop (data is kept) |
| `docker compose down -v` | stop **and delete the database** (migrations run again next start) |

How it fits together: `web` (nginx) serves the React files and forwards `/api/...` to `api:3000`; `api` talks to `db` with the limited `guesthouse_app` login. The database has no port open to the outside.

## B. Free hosting online: Neon (database) + Render (API + website)

### 1. Database on Neon (free Postgres)
1. Sign up at neon.tech → create a project (Postgres 16, region Singapore/Mumbai if offered).
2. Copy the **connection string** (`postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require`).
3. From your project root in PowerShell, run the migrations against Neon:
   ```powershell
   $NEON = "postgresql://neondb_owner:...neon.tech/neondb?sslmode=require"
   psql $NEON -c "CREATE EXTENSION IF NOT EXISTS btree_gist"
   Get-ChildItem db\migrations\*.sql | Sort-Object Name | ForEach-Object { psql $NEON -v ON_ERROR_STOP=1 -f $_.FullName }
   psql $NEON -c "ALTER ROLE guesthouse_app PASSWORD 'a-long-random-password-here-123456'"
   ```
   (Neon wants strong role passwords. Use a long random one.)
4. Your API's `DATABASE_URL` = the same host, but user `guesthouse_app` and that password, e.g.
   `postgresql://guesthouse_app:PASSWORD@ep-xxx.neon.tech/neondb?sslmode=require`

### 2. API on Render (free Web Service)
1. Push the repo to GitHub. On render.com → **New → Web Service** → pick the repo.
2. **Root Directory:** `api` · **Runtime:** Node · **Build:** `npm ci` · **Start:** `npm start`
3. **Environment variables:**
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the guesthouse_app Neon URL above |
   | `JWT_SECRET` | 64 random characters |
   | `CORS_ORIGIN` | `https://YOUR-WEB.onrender.com` |
   | `COOKIE_SAMESITE` | `lax` |
   | `COOKIE_SECURE` | `true` |
   | `TRUST_PROXY` | `1` |
4. After deploy, open `https://YOUR-API.onrender.com/health`. It should say `"db_user":"guesthouse_app"`.
5. Create the admin from your PC (the script only needs the DB URL):
   ```powershell
   cd api
   $env:DATABASE_URL = "postgresql://guesthouse_app:...neon.tech/neondb?sslmode=require"
   npm run create-admin -- admin@guesthouse.in "YourStrongPass1" "Rushil Sharma"
   Remove-Item Env:DATABASE_URL
   ```

### 3. Website on Render (free Static Site)
1. **New → Static Site** → same repo. **Root Directory:** `web` · **Build:** `npm ci && npm run build` · **Publish directory:** `dist`
2. **Redirects/Rewrites** (in this order):
   | Source | Destination | Action |
   |---|---|---|
   | `/api/*` | `https://YOUR-API.onrender.com/*` | Rewrite |
   | `/*` | `/index.html` | Rewrite |
   The first rule makes `/api` work exactly like nginx does locally (same site → cookie works). The second lets React Router handle `/bookings/5`.
3. Open `https://YOUR-WEB.onrender.com` and log in.

**If the cookie doesn't stick** through the rewrite, use the "two domains" setup instead: set the static site env var `VITE_API_URL=https://YOUR-API.onrender.com` (rebuild), and on the API set `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `CORS_ORIGIN=https://YOUR-WEB.onrender.com`. (Some browsers block third-party cookies, which is why the rewrite is the first choice.)

**Free-tier notes:** Render's free API sleeps after ~15 min idle (the first request takes ~30-50 s to wake it, so open it before your demo). Neon's free database also sleeps but wakes in about a second.

Alternatives: Railway (can run the whole `docker-compose.yml`-style setup, small free trial credit), or Vercel/Netlify for the website with the same `/api/*` rewrite idea.

## Env var cheat-sheet (API)
| Var | Local dev | Docker | Online |
|---|---|---|---|
| DATABASE_URL | `postgres://guesthouse_app:...@localhost:5432/guesthouse` | set by compose | Neon guesthouse_app URL |
| JWT_SECRET | 32+ random chars | from root `.env` | 64 random chars |
| CORS_ORIGIN | `http://localhost:5173` | `http://localhost:8080` | your website URL |
| COOKIE_SAMESITE / COOKIE_SECURE | `lax` / `false` | `lax` / `false` | `lax` / `true` |
| TRUST_PROXY | (unset) | `1` | `1` |
