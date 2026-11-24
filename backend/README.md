# tracking-service

Go service for Project Tracking: projects, boards, lists, cards, checklists, comments, labels, members.
It stores data in PostgreSQL when `DATABASE_URL` is set, and in memory otherwise (local only; lost on restart).

## Database (PostgreSQL 14+)

One-time setup, as a superuser (pgAdmin or psql):

1. Create an empty database, e.g. `tracking`.
2. Run [`db/bootstrap.sql`](db/bootstrap.sql) in it. It makes the login role `tracking_app` and the schema `tracking`
   (owned by that role), and sets the role's time zone (Asia/Bangkok) and `search_path` for this database.
   Safe to run again.
3. Give the role a password: `ALTER ROLE tracking_app PASSWORD '...';`
4. Put the URL in `backend/.env.local` (git-ignored; read at start-up, the shell environment wins):

   ```
   DATABASE_URL=postgres://tracking_app:<password>@127.0.0.1:5432/tracking
   ```

On start the service applies the migrations in `internal/store/postgres/migrations` (goose; version in
`tracking.goose_db_version`), so the tables are never created by hand. A schema change is a new numbered file there,
never an edit of one that has run. With `ENV=local` an empty database is seeded once with the sample data; after
that, data stays across restarts. Outside `ENV=local`, `DATABASE_URL` is required.

Tests run on the memory store by default. To run the same tests on PostgreSQL, point
`TRACKING_TEST_DATABASE_URL` at a superuser on a disposable server (each test gets its own database, copied from a
migrated template):

```sh
TRACKING_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres go test ./...
```

## Run locally

```sh
cd backend
ENV=local go run -tags local ./cmd/tracking-service
```

- Listens on port `8081` (`PORT` overrides it). With `ENV=local` it listens on `127.0.0.1` only, because the local build trusts an `X-User-ID` header; elsewhere on every interface. `HOST` overrides either. Base path `/api/tracking/v1`; liveness at `/healthz`.
- `ENV=local` needs the `local` build tag. The tag compiles the `X-User-ID` header authenticator, which must never ship in a production build. Without the tag the service exits at start.
- With `ENV=local` an empty store is seeded on start: the prototype's two projects and, with `SEED_LARGE=1`, a third project `Load Test` (8 lists, 2,000 cards). The memory store starts empty every time; a database is seeded only once.
- Report PDFs (PDF only, at most 20 MB) are stored under `UPLOAD_DIR` (default `./uploads`, git-ignored; use a persistent volume when deployed); only metadata is in the store. `GET /projects` returns each project's `documentCount`, and a document carries `uploadedByName` from the user cache. With `ENV=local`, PDFs in `../reports/website-redesign/` and `../reports/mobile-app-v2/` are imported into projects 1 and 2 on start, when those folders exist.
- API contract: `api/openapi.yaml` (the frontend generates its types from it).

```sh
curl -s -H "X-User-ID: 2" localhost:8081/api/tracking/v1/projects
```

### Hot reload (air)

```sh
go install github.com/air-verse/air@latest   # once
cd backend
air
```

`.air.toml` rebuilds and restarts the service on every `.go` change (test files excluded). It builds with
`-tags local` and reads `ENV=local` and `PORT=8081` from `air.env`, so a plain `air` works in bash and PowerShell.
Edit `air.env` to change the port or add `SEED_LARGE=1` / `UPLOAD_DIR`. The binary goes to `tmp/` (git-ignored).
`uploads/` is not watched, so uploading a PDF does not restart the service. Without `DATABASE_URL` each restart
re-seeds the in-memory store, so data you changed is lost on every rebuild; with it, data stays. Local development only.

In VS Code, `Ctrl+Shift+B` runs the default build task `dev` (`.vscode/tasks.json`). It starts this backend with air
and the frontend dev server, each in its own terminal. Stop both with the `dev: stop` task
(`scripts/dev-down.ps1`: stops whatever listens on 8081 and 3000, plus air). Bind it to a key in your user
keybindings, for example `Ctrl+Alt+Shift+B` → `workbench.action.tasks.terminate` (`terminateAll`), then `dev: stop`.

### Dev users

Pass the id in the `X-User-ID` header. Names come from the stub user-service (ids 1-8).

| Id | Name | System role | Website Redesign | Mobile App v2 |
|---|---|---|---|---|
| 1 | สมชาย ใจดี | admin | sees all projects | sees all projects |
| 2 | Napat K. | manager | pm | pm |
| 3 | วิภา รักงาน | none | member | not a member |
| 4 | Somsak P. | none | member | not a member |
| 5 | ปิยะ มั่นคง | none | member | pm |
| 6 | Mali S. | none | member | not a member |
| 7 | ธนากร ทองดี | none | member | member |
| 8 | Anan T. | none | not a member | member |

Only admins and managers can create projects. Seed project ids: 1 Website Redesign, 2 Mobile App v2 (on hold), 3 Load Test (only with `SEED_LARGE=1`).

## Dashboard

`GET /api/tracking/v1/dashboard?projectId=<id>` returns totals, per-project and per-person counts, open tasks by priority and the next deadlines. `projectId` is optional; a project the caller cannot see answers `not_found`. Admins see all non-archived projects, everyone else sees the projects they belong to. Only active cards in active lists count.

"Today" is the date in Asia/Bangkok (fixed +07:00 if the zone database is missing). Status rules, the same as the Timeline: done = `completedAt` set; overdue = not done and due before today; in progress = not done, not overdue, start on or before today; not started = the rest. "Due in 7 days" is open with today <= due <= today+7. Deadlines list overdue cards and cards due within 14 days, soonest first, at most 20.

## Tests

```sh
cd backend
go test -tags local ./... && go vet -tags local ./... && gofmt -l .
```

`gofmt -l .` must print nothing. `internal/httpx/routes_test.go` keeps `api/openapi.yaml` and the router in step: every route needs an operation and every operation needs a route.
