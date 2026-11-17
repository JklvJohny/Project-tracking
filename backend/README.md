# tracking-service

Go service for Project Tracking: projects, boards, lists, cards, checklists, comments, labels, members.
It runs on an in-memory store for now; PostgreSQL is written separately against `docs/db-contract.md`.

## Run locally

```sh
cd backend
ENV=local go run -tags local ./cmd/tracking-service
```

- Listens on `:8081` (`PORT` overrides it). Base path `/api/tracking/v1`; liveness at `/healthz`.
- `ENV=local` needs the `local` build tag. The tag compiles the `X-User-ID` header authenticator, which must never ship in a production build. Without the tag the service exits at start.
- With `ENV=local` the in-memory store is seeded on start: the prototype's two projects and, with `SEED_LARGE=1`, a third project `Load Test` (8 lists, 2,000 cards). Data is lost on restart.
- API contract: `api/openapi.yaml` (the frontend generates its types from it).

```sh
curl -s -H "X-User-ID: 2" localhost:8081/api/tracking/v1/projects
```

### Dev users

Pass the id in the `X-User-ID` header. Names come from the stub user-service (ids 1-8).

| Id | Name | System role | Website Redesign | Mobile App v2 |
|---|---|---|---|---|
| 1 | สมชาย ใจดี | admin | sees all projects | sees all projects |
| 2 | Napat K. | manager | pm | pm |
| 3 | วิภา รักงาน | none | member | not a member |
| 4 | Somsak P. | none | member | not a member |
| 5 | ปิยะ มั่นคง | none | member | pm |
| 6 | Mali S. | none | viewer | not a member |
| 7 | ธนากร ทองดี | none | member | member |
| 8 | Anan T. | none | not a member | viewer |

Only admins and managers can create projects. Seed project ids: 1 Website Redesign, 2 Mobile App v2 (on hold), 3 Load Test (only with `SEED_LARGE=1`).

## Tests

```sh
cd backend
go test -tags local ./... && go vet -tags local ./... && gofmt -l .
```

`gofmt -l .` must print nothing. `internal/httpx/routes_test.go` keeps `api/openapi.yaml` and the router in step: every route needs an operation and every operation needs a route.
