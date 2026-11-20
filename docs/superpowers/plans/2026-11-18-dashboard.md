# Dashboard Implementation Plan

> Execute with superpowers:subagent-driven-development. **Owner decision, as in the previous plan: no per-task review.** Each task runs its own tests. One whole-branch review plus a real-Chrome pass happens at the end (Task 3).

**Goal:** Build the Dashboard page from `index.html` with a single backend aggregate endpoint.

**Architecture:**
- **Backend:** a new `dashboard` package. One store call, `Dashboard.Rows`, feeds a pure Go aggregator, `dashboard.Build`. The handler is `GET /dashboard`.
- **Frontend:** a new `/tracking/dashboard` route made of CSS-bar components.

**Tech stack:** Go/chi on the backend; Next.js 16, TanStack Query, Tailwind and shadcn on the frontend.

**Spec:** `docs/superpowers/specs/2026-11-18-dashboard-design.md`.

## Global Constraints

- **Conventions and rulings:**
  - Every earlier convention still applies: `.superpowers/sdd/2026-11-17-tracking-p1/global-constraints.md` (R1–R15), R16, and both project skills.
  - Buttons keep the neutral primary.
  - Every string is in a th/en `TEXT` dictionary.
  - No raw hex in components.
  - Request and response types come from the generated schema. Run `npm run gen:api` after any API change.
- **Gates:**
  - backend: `go test -tags local ./... && go vet -tags local ./... && gofmt -l .`
  - frontend: `npx vitest run && npx tsc --noEmit`, run from an **upper-case `D:\`** path.
- **Commits:** one commit per task, Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push nothing.

---

### Task 1: Backend dashboard endpoint

**Files:**
- `backend/internal/dashboard/{build.go,build_test.go,service.go,handlers.go,service_test.go}`
- `backend/internal/store/{entities.go,repos.go}`: `DashboardRow` and a `Dashboard` repo
- `backend/internal/store/memory/dashboard_repo.go`
- `backend/cmd/tracking-service/main.go`: mount the routes
- `backend/api/openapi.yaml`, `docs/db-contract.md`, frontend `schema.d.ts` (regenerate)

**Produces:**
- `dashboard.Build(rows []store.DashboardRow, members []store.Member, users map[int64]store.CachedUser, today store.Date) View`. It is pure and implements the spec's status rules, ordering and limits.
- `dashboard.New(st, now clock.Clock)` and `dashboard.Mount(r, s)`, serving `GET /dashboard?projectId=`.
- A non-member asking for a `projectId` gets `not_found`. An admin sees all non-archived projects. Today is computed in Asia/Bangkok.

**Tests:**
- Build covers status classification at the boundaries (due == today is not overdue; start == today counts as in progress), dueSoon spanning 0–7 days, unassigned counting, workload ordering with zero-task members included, all four priorities present, deadlines filtering, ordering and the cap of 20, and `daysLeft`.
- Service and handler cover scope filtering (non-member 404; admin sees all; archived projects, lists and cards excluded), the JSON shape (no nil slices), and the routes/openapi test.

### Task 2: Frontend dashboard page

**Files:**
- `frontend/app/tracking/dashboard/*`
- `app/(dev)/DevShell.tsx`: Dashboard becomes a live link with `aria-current`
- `app/tracking/shared/routes.ts`: `dashboard`
- `docs/host-integration.md`: a sidebar entry for Dashboard

**Produces** the spec's "What the page shows":
- the header with the scope select bound to `?project=` and the disabled Import tasks button;
- 5 StatTiles;
- StackedBars for projects and for workload, each with a legend and a "View as table" toggle;
- PriorityBars;
- the Deadlines list linking to the card;
- loading, empty and error states;
- Thai and English.

At 400px everything stacks with no page-level horizontal scroll. Visual reference: `C:/Users/tripl/AppData/Local/Temp/claude/53d88e2cfbab76e9/14764d43-0eba-4337-99f9-0f3bcebdfe82/scratchpad/cmp-proto-projects.png`. Despite its name, that file is the prototype **Dashboard** screenshot. Also grep `function Dashboard`, `StatTile` and `StackedChart` in `index.html`.

**Tests:**
- the tiles render the API numbers;
- the scope select updates `?project=` and the query;
- the table toggle shows a real table with the same numbers;
- a deadline row links to `?card=`;
- the empty and error states render;
- TH and EN text differ;
- legends carry text and not only colour.

### Task 3: Docs, Chrome pass, whole-branch review

1. Update `frontend/README.md`, `backend/README.md` and `docs/host-integration.md`.
2. Run a real-Chrome pass (Chrome via playwright-core; scripts go in the scratchpad):
   - dashboard in TH and EN, light and dark, at 1440 and 400px, as users 1, 2, 3 and 6;
   - check the scope switch, the table toggle and the deadline click-through;
   - compare against the prototype screenshot.
3. Fix any defect you find, with a test.
4. Run all gates, including `npx next build`.
5. The controller then runs one whole-branch review and one fix wave.
