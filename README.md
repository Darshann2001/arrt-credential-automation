# ARRT Credential Verification — Supervised Collection

A small full-stack demo: create a job, click **Run Job**, solve the reCAPTCHA
yourself in a visible Chrome window, and the results table is extracted, stored
in PostgreSQL, and shown in the dashboard.

The CAPTCHA is always solved by a human operator. There is no solver, token
access/injection, stealth, fingerprinting or proxy rotation. Live collection is
fail-closed until authorization, CAPTCHA approval and permitted limits are set.

## Requirements

- Node.js **20.9+** (backend needs 18.18+; frontend needs 20.9+)
- PostgreSQL 14+ (or Docker for the bundled `docker-compose.yml`)
- **Google Chrome installed on the machine running the backend**
- Git

## Setup (each machine, e.g. HR's machine)

```bash
# 1. Get the code
git clone <REPO_URL> arrt-automation
cd arrt-automation

# 2. Backend
cd backend
npm install
cp .env.example .env          # then edit .env (see below)
docker compose up -d          # local PostgreSQL, or point DATABASE_URL at yours
npm run db:deploy             # apply committed migrations
npm run api:start             # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm install
cp .env.example .env.local
npm run dev                   # http://localhost:3000
```

### Backend `.env`

See [`.env.example`](.env.example) at the repo root for every value, what it
means, and where it comes from. Minimum to run live:

```env
DATABASE_URL="postgresql://arrt:arrt@localhost:5432/arrt?schema=public"
FRONTEND_URL="http://localhost:3000"

LIVE_AUTHORIZATION_CONFIRMED="true"
LIVE_AUTHORIZATION_REFERENCE="<your approval reference>"
LIVE_AUTHORIZATION_SCOPE="ARRT_VERIFY_CREDENTIALS,SUPERVISED_RUN"
LIVE_CAPTCHA_APPROVED="true"
LIVE_CAPTCHA_APPROVAL_REFERENCE="<your approval reference>"
LIVE_MAX_RECORDS_PER_JOB="350"
LIVE_MAX_SEARCHES_PER_JOB="100"
LIVE_MAX_JOBS_PER_DAY="10"
LIVE_BROWSER_EXECUTABLE_PATH="<path to chrome.exe on this machine>"
LIVE_BROWSER_HEADLESS="false"
```

On Windows use forward slashes in the Chrome path, for example
`C:/Program Files/Google/Chrome/Application/chrome.exe`. Keep
`LIVE_BROWSER_HEADLESS="false"` — headless runs are rejected. `backend/.env` is
git-ignored; never commit real values.

## Run a live collection

1. Open <http://localhost:3000> → **Jobs** → **New job** → create a pending job.
2. Open that job's detail page and click **Run Job**.
3. A **visible Chrome window** opens on the ARRT verify-credentials page with the
   first/last wildcard pair already filled in. Solve the reCAPTCHA yourself and
   submit the form.
4. The worker extracts the results table, imports it into PostgreSQL, and the
   job status changes to `COMPLETED`. Records appear on the dashboard and
   **Records** page. Status polls automatically while running.
5. Browser cookies stay in the local, git-ignored `backend/.browser-profile/`.

If the gate is configured incorrectly, the Run button fails with a clear code
(e.g. `AUTHORIZATION_NOT_CONFIRMED`, `CAPTCHA_REQUIRES_APPROVAL`,
`COLLECTION_LIMIT_EXCEEDED`) and nothing launches.

## Validation

```bash
cd backend && npm test     # 145/145
cd frontend && npm test    # 22/22
cd frontend && npm run build
```

## Scope notes

- Real records contain personal information. Only use data you are authorized
  to collect and share.
- Results are read from the single rendered results page; multi-page pagination
  has not been verified.
- One CAPTCHA may be required per wildcard search if the record target is not
  reached on the first search.
- Detailed docs live in [`docs/`](docs/) and
  [`backend/README.md`](backend/README.md).
