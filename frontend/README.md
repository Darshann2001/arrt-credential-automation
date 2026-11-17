# ARRT Credential Dashboard (Phase 5)

Next.js admin dashboard for the Express/Prisma API in `../backend`.

## Setup

Node.js 20.9+ is required.

```bash
cd frontend
npm install
cp .env.example .env.local   # optional if the defaults already match
```

`.env.local` contains only the browser-visible API base URL:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

The backend must allow the frontend origin in `backend/.env`:

```env
FRONTEND_URL="http://localhost:3000"
```

> `.npmrc` enables `legacy-peer-deps` because npm 10.9.3's Arborist crashes while
> resolving optional Vitest/jsdom peers. The React and Testing Library peers are
> declared explicitly.

## Run

Start PostgreSQL and the backend first:

```bash
cd backend
docker compose up -d
npm install
npm run db:deploy
npm run api:start
```

Then start the frontend:

```bash
cd frontend
npm run dev
```

Open <http://localhost:3000>. For a production build:

```bash
cd frontend
npm run build
npm start
```

## Validation

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Live dashboard statistics, distributions and recent records |
| `/records` | Search, filters, sorting, server-side pagination and CSV export |
| `/jobs` | Job history, counters, status filter and pagination |
| `/jobs/[id]` | Job details, counters and log entries |
| `/jobs/new` | Create a pending job through `POST /api/jobs` |

## Connected endpoints

- `GET /api/health`
- `GET /api/dashboard/stats`
- `GET /api/records`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs`

## Collection scope

Creating a job only stores a `PENDING` row and an `INFO` log. It does **not**
open a browser, contact ARRT, start live collection, or enable unattended
collection. The dashboard never starts automation.

## Demo vs imported records

The `source` field returned by the API is authoritative. Rows whose source is
`DEMO`, `SEED`, `FIXTURE`, `SAMPLE` or `TEST` are labelled **Demo data**. Other
source values are displayed as imported source labels. No source value is
invented by the frontend.
