# Phase 4 — PostgreSQL, Prisma and the Express API

**Status:** implemented and verified  
**Date:** 2026-11-17  
**Scope:** persistence + read/write HTTP API over stored records  
**Dependencies:** `express`, `cors`, `zod`, `@prisma/client`, `prisma` (dev)

---

## 1. Scope and constraints

This phase adds a PostgreSQL database, a Prisma data layer and an Express API.
It does **not**:

- contact ARRT, open a browser, or solve CAPTCHAs;
- start live collection: `POST /api/jobs` only creates a `PENDING` job row;
- reverse-engineer or invent an ARRT credential format;
- include a frontend.

Existing extraction and automation modules are unchanged in behaviour. The API
reuses the extraction engine's `normalizeRecordValues` and `validateRecordValues`
so imported records follow exactly the same contract as fixture extraction.

Records store directory facts only. No CAPTCHA material, cookies, session
identifiers, anti-forgery tokens or real person data are stored or committed.

### 1.1 ARRT record ids

ARRT does not expose a stable public record id, so the database does not assume
one exists. Identity is the composite:

```
(normalizedName, normalizedCity, normalizedState, normalizedCredential)
```

`normalizedName`/`normalizedCity` are case-folded comparison keys,
`normalizedState` is the USPS code, and `normalizedCredential` is lower-cased.
The same person with a different credential is therefore a distinct row, while
whitespace, case and full-state-name variations collapse to one row.

---

## 2. Architecture

Request flow is strictly one direction. Only repositories talk to Prisma.

| Layer | Location | Responsibility |
| --- | --- | --- |
| Routes | `src/api/routes/` | Mount paths, attach validation, no logic |
| Validation | `src/api/validation/` | Zod schemas for params/query/body |
| Controllers | `src/api/controllers/` | Read validated input, call one service, shape response |
| Services | `src/api/services/` | Business rules, pagination, aggregation, normalization |
| Repositories | `src/api/repositories/` | All Prisma queries and filter mapping |
| Database | `src/db/prisma.js`, `prisma/` | Lazy client, schema, migrations |
| Cross-cutting | `src/api/middleware/` | Request id, CORS, validation, 404, error mapping |

`createApp({ prisma, config, logger })` accepts an injected Prisma client. The
real client is created lazily by `src/api/server.js`, so importing any
`src/api/*` module never opens a database connection. Tests inject an in-memory
double.

```
src/api/app.js          app factory (wiring)
src/api/server.js       runtime entry (loads .env, requires DATABASE_URL)
src/api/index.js        public barrel for the API layer
src/config/env.js       PORT / DATABASE_URL / FRONTEND_URL / NODE_ENV
src/config/cors.js      exact-origin CORS policy
src/db/prisma.js        lazy singleton PrismaClient
prisma/schema.prisma    models, enums, indexes, unique identity
prisma/migrations/      versioned SQL migration
```

---

## 3. Data model

### 3.1 `CredentialRecord` → table `credential_records`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | primary key, `uuid()` default |
| `fullName` | `TEXT` | normalized display name |
| `city` | `TEXT` | normalized display city |
| `state` | `TEXT` | USPS code |
| `credentialString` | `TEXT` | source credential text, normalized whitespace only |
| `normalizedName` | `TEXT` | comparison key |
| `normalizedCity` | `TEXT` | comparison key |
| `normalizedState` | `TEXT` | comparison key |
| `normalizedCredential` | `TEXT` | comparison key |
| `source` | `TEXT` | default `ARRT` |
| `createdAt` | `TIMESTAMP(3)` | default `now()` |
| `updatedAt` | `TIMESTAMP(3)` | auto-updated |

Constraints and indexes:

- unique `credential_records_identity_key` on
  `(normalizedName, normalizedCity, normalizedState, normalizedCredential)`;
- indexes on `normalizedName`, `normalizedState`, `normalizedCity`,
  `normalizedCredential`, `(state, city)` and `createdAt`.

The `normalized*` keys are internal. API responses expose only:

```
id, fullName, city, state, credentialString, source, createdAt, updatedAt
```

### 3.2 `CollectionJob` → table `collection_jobs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | primary key |
| `status` | `JobStatus` | `PENDING` default |
| `source` | `TEXT` | default `ARRT` |
| `requestedTarget` | `INTEGER` | default `0`; API default `350` |
| `recordsFound` | `INTEGER` | default `0` |
| `recordsInserted` | `INTEGER` | default `0` |
| `recordsSkipped` | `INTEGER` | default `0` |
| `recordsRejected` | `INTEGER` | default `0` |
| `startedAt` | `TIMESTAMP(3)` | nullable |
| `completedAt` | `TIMESTAMP(3)` | nullable |
| `errorMessage` | `TEXT` | nullable; safe message only |
| `createdAt` / `updatedAt` | `TIMESTAMP(3)` | timestamps |

Indexes on `status` and `createdAt`. Counters are denormalized so job history
stays readable if records are later removed.

### 3.3 `CollectionJobLog` → table `collection_job_logs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | primary key |
| `jobId` | `UUID` | FK → `collection_jobs.id`, `ON DELETE CASCADE` |
| `level` | `LogLevel` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `message` | `TEXT` | human-readable, no secrets |
| `createdAt` | `TIMESTAMP(3)` | default `now()` |

Index on `(jobId, createdAt)`; job detail returns logs in ascending time order.

### 3.4 Enums

```prisma
enum JobStatus { PENDING RUNNING COMPLETED FAILED CANCELLED }
enum LogLevel  { DEBUG INFO WARN ERROR }
```

---

## 4. Environment setup

Copy the template and edit local values:

```powershell
cd backend
Copy-Item .env.example .env
```

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes (server start) | — | PostgreSQL connection string |
| `PORT` | no | `4000` | HTTP listen port |
| `FRONTEND_URL` | no | `http://localhost:3000` | comma-separated allowed CORS origins |
| `NODE_ENV` | no | `development` | `development` / `test` / `production` |

`.env.example`:

```dotenv
DATABASE_URL="postgresql://arrt:arrt@localhost:5432/arrt?schema=public"
PORT=4000
FRONTEND_URL="http://localhost:3000"
NODE_ENV=development
```

Never commit a real `.env` or real credentials. `DATABASE_URL` is validated only
when the server starts; Prisma CLI commands need it for migrations.

### 4.1 Optional Docker PostgreSQL

`backend/docker-compose.yml` provides a local-only database:

```powershell
cd backend
docker compose up -d
```

This starts `postgres:16-alpine` on `localhost:5432` with database/user/password
`arrt`. The credentials are local defaults and must not be reused elsewhere.

### 4.2 Migrations

```powershell
cd backend
npm run db:generate     # prisma generate
npm run db:validate     # prisma validate
npm run db:deploy       # prisma migrate deploy  (CI / fresh local DB)
npm run db:migrate      # prisma migrate dev     (interactive, new migrations)
npm run db:status       # prisma migrate status
npm run db:studio       # prisma studio
```

The initial migration is
`prisma/migrations/20261117000000_init/migration.sql`. It creates the two enums,
three tables, all indexes and the foreign key. For a brand-new database:

```powershell
docker compose up -d
npm run db:deploy
```

`db:deploy` applies committed migrations without prompting. Use `db:migrate`
only while developing a schema change.

> `npm run db:validate` / `db:generate` read `DATABASE_URL`. If it is unset in
> the shell, put it in `backend/.env` (Prisma reads `.env` automatically) or set
> `$env:DATABASE_URL` for the session.

---

## 5. Running the API

```powershell
cd backend
npm run api:start      # alias: npm run start:api
```

The server loads `backend/.env` (Node's native `process.loadEnvFile`, no dotenv
dependency), refuses to start without `DATABASE_URL`, and shuts down gracefully
on `SIGINT`/`SIGTERM`, disconnecting Prisma.

Health check:

```powershell
curl.exe http://localhost:4000/api/health
```

---

## 6. Endpoints

Base path: `/api`. All responses are JSON. List endpoints return
`{ data, pagination }`; single-resource and action endpoints return `{ data }`.

Errors always have the shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request.",
    "details": {
      "fields": [{ "path": "page", "message": "page must be at least 1." }]
    }
  },
  "requestId": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

Every response carries an `X-Request-Id` header. An incoming `X-Request-Id` that
matches `[A-Za-z0-9._-]{1,100}` is echoed; otherwise a UUID is generated.
`details` is optional and only contains client-safe validation information.

### 6.1 `GET /api/health`

Liveness/readiness probe. Runs `SELECT 1`.

- `200` with `status: "ok"`, `database: "ok"` when reachable.
- `503` with `status: "degraded"`, `database: "unavailable"` otherwise.
- Driver messages, hosts and connection strings are never returned.

```json
{
  "status": "ok",
  "database": "ok",
  "uptimeSeconds": 42,
  "latencyMs": 3,
  "timestamp": "2026-11-17T12:00:00.000Z"
}
```

### 6.2 `GET /api/records`

Paginated, filtered, sortable record list.

| Query | Type | Default | Rules |
| --- | --- | --- | --- |
| `page` | integer | `1` | `>= 1` |
| `pageSize` | integer | `25` | `1..200` |
| `search` | string | — | case-insensitive `fullName` contains, max 120 |
| `state` | string | — | full name or USPS code, max 60 |
| `city` | string | — | case-insensitive contains, max 80 |
| `credential` | string | — | case-insensitive contains, max 100 |
| `sortBy` | enum | `createdAt` | `createdAt`, `updatedAt`, `fullName`, `city`, `state`, `credentialString` |
| `sortOrder` | enum | `desc` | `asc`, `desc` |

Unknown or out-of-range values return `400 VALIDATION_ERROR`. `sortBy` is
whitelisted; arbitrary column names are rejected.

```http
GET /api/records?search=smith&state=IL&page=1&pageSize=25&sortBy=fullName&sortOrder=asc
```

```json
{
  "data": [
    {
      "id": "3f1c9e7a-5b2d-4c8e-9f10-1a2b3c4d5e6f",
      "fullName": "Alice Smith",
      "city": "Springfield",
      "state": "IL",
      "credentialString": "TEST-0001",
      "source": "ARRT",
      "createdAt": "2026-11-17T12:00:00.000Z",
      "updatedAt": "2026-11-17T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

### 6.3 `GET /api/records/:id`

- `id` must be a UUID, otherwise `400 VALIDATION_ERROR`.
- `200` with `{ data: record }`.
- `404 RECORD_NOT_FOUND` when no row matches.

### 6.4 `POST /api/records/import`

Bulk import with normalization, validation and safe duplicate handling. This is
the only record write path in this phase. It does **not** call ARRT.

Request body (`strict`; unknown keys are rejected):

| Field | Type | Rules |
| --- | --- | --- |
| `records` | array | required, `1..5000` entries |
| `source` | string | optional, `1..50` chars, default `ARRT` |
| `jobId` | UUID | optional; links counters to an existing job |

Each entry is normalized and validated with the extraction engine. `recordId` is
intentionally not stored. Duplicates are detected by the composite identity key,
covering both rows already in the table and duplicates within the same request
(`createMany({ skipDuplicates: true })`).

Returns `200` with partial-success counts:

```json
{
  "data": {
    "received": 3,
    "accepted": 2,
    "inserted": 1,
    "skipped": 1,
    "rejected": 1,
    "rejectedRecords": [
      {
        "index": 2,
        "code": "INVALID_STATE",
        "field": "state",
        "message": "state must be a recognized U.S. state name or postal code."
      }
    ],
    "jobId": "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d"
  }
}
```

Semantics:

- `received` = entries submitted;
- `accepted` = entries that passed normalization/validation;
- `inserted` = rows actually written;
- `skipped` = accepted duplicates (stored or in-batch);
- `rejected` = entries that failed validation (counted, never stored).

Rejected diagnostics include `index`, `code`, `field` and a safe `message`. Raw
values, including invalid state text, are **not** echoed. If `jobId` is supplied
but does not exist, the response is `404 JOB_NOT_FOUND`; when it exists, counters
and a `WARN`/`INFO` log are appended atomically.

Validation codes come from the extraction engine, e.g. `MISSING_FULL_NAME`,
`MISSING_CITY`, `MISSING_CREDENTIAL`, `INVALID_STATE`, `INVALID_RECORD`.

### 6.5 `GET /api/jobs`

Paginated job list, newest first.

| Query | Type | Default | Rules |
| --- | --- | --- | --- |
| `page` | integer | `1` | `>= 1` |
| `pageSize` | integer | `25` | `1..200` |
| `status` | enum | — | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |

Response is `{ data, pagination }` using the same pagination metadata as records.

### 6.6 `GET /api/jobs/:id`

- `200` with job fields plus `logs` sorted by `createdAt` ascending.
- `404 JOB_NOT_FOUND` when unknown; `400` for a non-UUID id.

```json
{
  "data": {
    "id": "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d",
    "status": "PENDING",
    "source": "ARRT",
    "requestedTarget": 350,
    "recordsFound": 0,
    "recordsInserted": 0,
    "recordsSkipped": 0,
    "recordsRejected": 0,
    "startedAt": null,
    "completedAt": null,
    "errorMessage": null,
    "createdAt": "2026-11-17T12:00:00.000Z",
    "updatedAt": "2026-11-17T12:00:00.000Z",
    "logs": [
      {
        "id": "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
        "jobId": "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d",
        "level": "INFO",
        "message": "Collection job created with status PENDING. Live ARRT collection is disabled in this phase.",
        "createdAt": "2026-11-17T12:00:00.000Z"
      }
    ]
  }
}
```

### 6.7 `POST /api/jobs`

Creates a `PENDING` job plus its first `INFO` log in one transaction. **No
provider is invoked, no browser opens and no network request to ARRT is made.**

| Body field | Type | Default | Rules |
| --- | --- | --- | --- |
| `requestedTarget` | integer | `350` | `0..100000` (`DEFAULT_TARGET_RECORDS.max`) |
| `source` | string | `ARRT` | `1..50` chars |

Returns `201` with `{ data: job }`. Unknown body keys return `400`.

### 6.8 `GET /api/dashboard/stats`

Aggregated dashboard counters.

| Query | Type | Default | Rules |
| --- | --- | --- | --- |
| `recentDays` | integer | `30` | `1..365` |

```json
{
  "data": {
    "totalRecords": 120,
    "totalJobs": 4,
    "completedJobs": 2,
    "failedJobs": 1,
    "recordsAddedRecently": {
      "windowDays": 30,
      "since": "2026-10-18T12:00:00.000Z",
      "count": 120
    },
    "recordsByState": [
      { "state": "CA", "count": 40 },
      { "state": "TX", "count": 25 }
    ],
    "recordsByCredentialType": [
      { "credentialType": "RT", "count": 90 },
      { "credentialType": "R", "count": 30 }
    ]
  }
}
```

`recordsByState` uses a grouped count in Prisma. `recordsByCredentialType` is a
**structural heuristic**, not an authoritative ARRT classification:

1. a parenthesized discipline token: `R.T.(R)(CT)` → `R`;
2. otherwise the leading letters: `RT-123` → `RT`;
3. otherwise the leading alphanumeric token;
4. otherwise `UNKNOWN`.

The stored `credentialString` is never reformatted.

---

## 7. Error handling

The error middleware is the only place that formats failures. Stack traces, SQL,
Prisma messages, hostnames and connection strings are logged server-side only
and never included in a response.

| Trigger | Status | `error.code` |
| --- | --- | --- |
| Zod validation failure | `400` | `VALIDATION_ERROR` |
| Malformed JSON body | `400` | `VALIDATION_ERROR` |
| Body over 2 MB | `413` | `PAYLOAD_TOO_LARGE` |
| Unknown route | `404` | `NOT_FOUND` |
| Missing record | `404` | `RECORD_NOT_FOUND` |
| Missing job | `404` | `JOB_NOT_FOUND` |
| Prisma `P2002` unique violation | `409` | `DUPLICATE_RECORD` |
| Prisma `P2003` FK violation | `409` | `RELATION_CONFLICT` |
| Prisma `P2025` missing row | `404` | `NOT_FOUND` |
| Prisma `P1xxx` connection/init | `503` | `DATABASE_UNAVAILABLE` |
| Other Prisma `P####` | `500` | `DATABASE_ERROR` |
| Unexpected error | `500` | `INTERNAL_ERROR` |

CORS allows exactly the origins in `FRONTEND_URL` (comma-separated). Requests
with no `Origin` header — curl, server-to-server, health checks — are allowed.

---

## 8. Tests

The suite requires **no PostgreSQL** and never contacts ARRT. `src/tests/api.test.js`
starts a real Express app on an ephemeral port and drives it with `fetch`, using
an in-memory Prisma double (`src/tests/helpers/fake-prisma.js`) that reproduces
`P2002`/`P2025`/`P2003` and supports failure injection.

```powershell
cd backend
npm run test:api     # 24 API tests
npm test             # full suite
```

API coverage:

| Area | Cases |
| --- | --- |
| Health | ok; degraded without leaking connection details |
| Import | normalization; stored + in-batch duplicates; rejects invalid rows without echoing values; job linkage; unknown `jobId` |
| Records | name search; state/city/credential filters; pagination metadata; whitelisted sorting both directions; detail by id; unknown/invalid id |
| Jobs | create pending job + log, no live collection; list pagination/status filter; detail with ordered logs |
| Dashboard | totals, completed/failed jobs, recent window, by-state, credential-type grouping |
| Validation | bad query params; bad bodies; malformed JSON; no DB writes on failure |
| Errors | `P1001` → 503; unexpected → 500; `P2002` → 409; unknown route → 404 |
| CORS | configured origin allowed; other origins rejected; no-Origin allowed |

Latest run: **136 tests, 136 passed, 0 failed** (24 of them API tests).

---

## 9. Operations checklist

1. `cd backend`
2. `docker compose up -d` (or point `DATABASE_URL` at an existing PostgreSQL)
3. `Copy-Item .env.example .env` and edit if needed
4. `npm run db:deploy`
5. `npm run api:start`
6. `curl.exe http://localhost:4000/api/health`

## 10. Known limitations

- **No live collection.** Creating a job does not run the automation engine;
  that remains a later, explicitly authorized phase.
- **No authentication/authorization.** The API exposes read endpoints and a
  create-job endpoint; add auth before any non-local deployment.
- **Credential type is approximate.** Dashboard grouping is derived from string
  structure and may merge or split types that ARRT treats differently.
- **ARRT record ids are not stored.** Dedupe relies on the composite identity
  key, so a legitimate change of city or credential creates a new row.
- **No automated PostgreSQL integration test.** HTTP/service behaviour is verified
  against the in-memory double; run `db:deploy` plus a manual smoke request to
  validate a real database.
