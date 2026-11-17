# Project Tracking P1: frontend + backend design

Date: 2026-11-17 · Status: draft for approval

## Intent

Turn the clickable prototype (`index.html`) into a real application for one department: a Next.js frontend and a Go `tracking-service` backend. The owner builds the PostgreSQL layer themselves, from `docs/ERD.md`. The backend must therefore run and be testable **now**, without a database. It must also hand the owner a precise contract that says what the database code has to provide.

## Goals

- Phase 1 (MVP) features from the plan, working end to end in the browser:
  - **Projects:** list, create, edit, archive, restore. Fields: name, description, owner, start and end dates, status (`active | on_hold | done`).
  - **Project members:** add, change role, remove. Roles: `pm | member | viewer`.
  - **Board** (one per project):
    - Lists: create, rename, reorder, archive, restore.
    - Cards: create, drag within and across lists, archive, restore.
  - **Card detail:**
    - Title, Markdown description, multiple assignees, start and due dates, priority (`low | medium | high | urgent`).
    - Colour labels: per project, created and edited from the card.
    - Checklist with % progress: add, edit, tick, reorder, delete.
    - Comments with @mentions: add, edit own, delete.
- Thai and English for every string. Light and dark theme. Responsive from 400px wide to desktop.
- Runs on one machine with `go run` and `npm run dev`, using in-memory data that is seeded on start.
- Moving to production changes only the adapters: auth, users, events and the database. The handlers and services stay as they are.

## Non-goals (later rounds)

- Dashboard, Timeline/Gantt, Import, Reports.
- Search and filters.
- Notifications UI and the activity log UI.
- Attachments, time tracking, real-time.
- The prototype already shows all of these. The route table leaves room for them, but nothing for them is built now.

## Anti-goals (failure even if it works)

- Any PostgreSQL code, SQL or migrations. They belong to the owner.
- A way to act as another user outside `ENV=local`. The `X-User-ID` header must be impossible to use in production builds and configs.
- Porting the prototype's vanilla JS line by line. It is a visual and behaviour reference only.
- Toast spam: drags and inline edits do not raise success toasts.
- Paid or cloud-only dependencies.

## Constraints (already decided)

- Stack: Go + `chi`; Next.js App Router + TypeScript + Tailwind + shadcn/ui; TanStack Query; dnd-kit.
- `docs/ERD.md` is the data model.
  - Keys are `int64`, including user ids, which come from user-service.
  - Enums are text, except priority, which is `smallint` 0–3. The API exposes priority as its name.
  - Archive, never purge.
  - LexoRank `position` keys.
  - `completed_at` is set when a card enters a list with `is_done`.
- Conventions:
  - `.claude/skills/project-tracking` covers i18n, error codes, permissions on the server and routes.
  - `.claude/skills/tracking-performance-ux` covers budgets, one request per screen, ETag, `setQueryData` patches and the feedback table.
- Free, open-source, self-hosted only.

## Approaches considered

**Where the code stops before the database** (decided by the owner: A)

- **A. Repository interfaces + in-memory store (chosen).** The service layer depends on Go interfaces. An in-memory implementation with seed data runs today. The owner later writes the PostgreSQL implementation of the same interfaces. The interfaces document exactly what the database must provide: which calls run in one transaction, and which need a row lock.
- B. Write sqlc queries against the ERD. Rejected: nothing runs until the database exists, and any deviation in the owner's tables breaks the queries.

**How the browser reaches the backend** (decided by the owner: 1)

- **1. Next.js rewrites (chosen).** The browser calls `/api/tracking/*` on its own origin. `next.config` rewrites the call to the Go service. There is no CORS, and the shape is the same as production, where a gateway sits in front of the service.
- 2. Browser calls Go directly. Rejected: needs CORS and its own token handling, and differs from production.
- 3. Next.js server fetches (BFF). Rejected: the board is interactive, and a server-side fetch layer would add a second cache and a second auth path for no gain.

## Design

### Repository layout

```
backend/                      Go module, service name tracking-service
  cmd/tracking-service/       main: config, wiring, HTTP server, graceful shutdown
  api/openapi.yaml            the contract (source of truth for the frontend types)
  internal/
    config/                   env vars: ENV, PORT, ...
    httpx/                    router, middleware, JSON + error envelope, ETag
    auth/                     Authenticator interface; local header impl (built only for ENV=local)
    users/                    UserProvider interface; stub with fake users
    events/                   EventPublisher interface; log impl
    rank/                     LexoRank key generation + rebalance
    project/ board/ card/     one package per module: types, service (rules + permission checks), handlers
    store/                    repository interfaces + Tx contract (what the DB must provide)
    store/memory/             in-memory implementation + seed data
frontend/                     minimal Next.js host for local dev
  app/layout.tsx, app/(dev)/  dev-only shell: stand-in sidebar, toggles, dev user switcher (NOT copied to the host)
  app/tracking/...            routes: the part that moves into the existing web app
  app/tracking/shared/        TrackingProvider, i18n, confirm(), toasts, generated API types + fetch wrapper
  app/tracking/tracking.css   tracking colour tokens
```

The folder is not yet a git repository. Initialising one is part of the plan. The owner moves `backend/` into the existing Go system when ready.

### Data access contract (`internal/store`)

- One interface per aggregate: `Projects`, `Members`, `Boards` (board + lists), `Cards`, `Labels`, `Checklist`, `Comments`, `UserRoles`, `UserCache`, `Activity`.
- **Names come from `user_cache`, never from user-service at read time.**
  - The service upserts a person into `user_cache` from `UserProvider` when that person is added as a member, assigned, or calls `GET /me`.
  - A background refresh re-reads rows older than 24 hours.
  - The board read joins `user_cache`, so it stays one consistent snapshot, with no network call on the hot path.
- **Activity is written from P1 (builder's call).** Every write calls `tx.Activity.Append(projectID, cardID, type, payload)` inside its transaction. The payload holds changed ids and values only, as the ERD says.
  - The owner implements this method as one `INSERT` into `activity_events`.
  - No activity UI is built in P1.
  - This keeps the skill's "same transaction" rule from day one, instead of reworking every write path in P2.
- **ETag (builder's call):** every write that changes the board payload bumps `boards.updated_at` in its transaction. That covers lists, cards, assignees, card labels, checklist items, comments, project labels and members. The ETag hashes `boards.updated_at` with the caller's role.
- Writes that must be atomic go through `store.Tx(ctx, func(tx Repos) error)`. These are:
  - a card move: rank, `completed_at` and the board `updated_at` bump;
  - a child write plus the `cards.updated_at` bump;
  - project creation: project, board, default lists, creator as PM.
- The memory implementation holds one mutex for the length of a transaction and rolls back on error.
- **Each method's doc comment states the SQL obligations** the owner must meet:
  - "locks the target list row (`SELECT … FOR UPDATE`) before computing the position";
  - "filters `archived_at IS NULL`";
  - "bumps `boards.updated_at`".
- The board read returns, in one call:
  - lists;
  - card summaries, without `description_md`;
  - assignee ids, label ids, checklist done/total and comment count per card;
  - project labels and members;
  - the ETag source, `boards.updated_at`.

### Ordering

The client never sends a position key. A move sends the neighbours it dropped between: `{ toListId, beforeId?, afterId? }`. The server computes the key between them while holding the lock. If the gap is exhausted, the server rebalances that list in the same transaction. Lists and checklist items move the same way.

### API

- Base path: `/api/tracking/v1`, JSON.
- A success answers `{ success: true, data }`. A failure answers `{ success: false, error, code }`.
- Codes:
  - `bad_request`, `validation_failed` (with `fields`);
  - `unauthorized`, `forbidden`, `not_found`, `conflict`;
  - `rate_limited` (unused for now), `server_error`.
- Endpoints (P1):

| Area | Endpoints |
|---|---|
| Me | `GET /me` (user, system role, capabilities) · `GET /users?q=` (people picker for adding members) |
| Projects | `GET /projects` · `POST /projects` · `GET/PATCH /projects/{id}` · `POST /projects/{id}/archive` · `POST /projects/{id}/restore` |
| Members | `GET/POST /projects/{id}/members` · `PATCH/DELETE /projects/{id}/members/{userId}` |
| Board | `GET /projects/{id}/board` (ETag / 304) · `GET /projects/{id}/archived` (archived lists and cards) |
| Lists | `POST /projects/{id}/lists` · `PATCH /lists/{id}` · `POST /lists/{id}/move` · `POST /lists/{id}/archive` · `POST /lists/{id}/restore` |
| Cards | `POST /lists/{id}/cards` · `GET/PATCH /cards/{id}` · `POST /cards/{id}/move` · `POST /cards/{id}/archive` · `POST /cards/{id}/restore` |
| Assignees | `PUT/DELETE /cards/{id}/assignees/{userId}` |
| Labels | `GET/POST /projects/{id}/labels` · `PATCH/DELETE /labels/{id}` · `PUT/DELETE /cards/{id}/labels/{labelId}` |
| Checklist | `POST /cards/{id}/checklist` · `PATCH/DELETE /checklist/{itemId}` · `POST /checklist/{itemId}/move` |
| Comments | `GET/POST /cards/{id}/comments` · `PATCH/DELETE /comments/{id}` |

- Every write returns the updated entity, so the client patches its cache with `setQueryData` and does not refetch the board.

### Permissions (server, every route)

| Action | admin | pm | member | viewer |
|---|---|---|---|---|
| See project, board, cards | ✓ (all projects) | ✓ | ✓ | ✓ |
| Create project | ✓ and `manager` | | | |
| Edit/archive project, manage members, lists (incl. marking a list as Done: `PATCH /lists/{id} {isDone}`), labels | ✓ | ✓ | | |
| Create/edit/move/archive cards, checklist, assignees, card labels | ✓ | ✓ | ✓ | |
| Comment | ✓ | ✓ | ✓ | |
| Edit a comment | author only | author only | author only | |
| Delete a comment | ✓ | ✓ | own | |

`GET /me` returns capabilities per project, so the UI hides controls. The server check is what enforces them. A project must always keep at least one PM: the last PM cannot be removed or demoted (`conflict`).

### Mentions

The @mention picker lists project members. Picking one inserts the token `@[<userId>]` into the body. The UI renders the person's current name in its place.

This design does not depend on user-service having a handle field. It also works for Thai names, which a `\w` regex does not match, and it survives a person renaming themselves. (Builder's call.)

When a comment is created or edited, the server:
- parses the tokens;
- keeps only ids that are project members, and leaves any other token as text;
- writes `comment_mentions`;
- publishes `tracking.comment.mentioned` through `EventPublisher`. Locally that event is only logged.

### Adapters (local vs production)

| Interface | Local (`ENV=local`) | Production |
|---|---|---|
| `auth.Authenticator` | reads `X-User-ID`; the file has a `//go:build local` tag, and `main` refuses to start if `ENV=local` is set on a non-local build | existing middleware or gateway header, written by the owner |
| `users.UserProvider` (`GetUsers`, `Search`) | 8 fake Thai/English users | user-service client |
| `events.EventPublisher` | logs JSON | existing broker |
| `store` | `store/memory` + seed (2 projects, as in the prototype) | the owner's PostgreSQL implementation |

### Frontend

**Production target (decided by the owner):** the pages are dropped into the **existing** Next.js web app. That app already has the login, the layout and the sidebar. The brief says it is App Router + TypeScript + Tailwind + shadcn/ui.

- **Self-contained:**
  - Everything lives under `app/tracking/` and `app/tracking/shared/`.
  - The only file outside it is one CSS file with the tracking tokens (`--s-*`, `--p-*`, `--pb-*`). These tokens sit on top of the host's shadcn variables, so tracking follows the host's theme.
  - Moving the pages into the host app means copying these folders, adding their npm dependencies, and adding one rewrite.
- **`TrackingProvider`** at the top of `app/tracking/layout.tsx` is the only seam with the host:
  - It takes `lang`, `theme` and `getAuthHeaders()` from the host.
  - When the host gives none (local), it falls back to its own language store and theme toggle.
  - The fetch wrapper assumes the host's session cookie is sent same-origin. It also adds whatever `getAuthHeaders()` returns, so a token-based host works without changes.
- **Local dev shell:**
  - `frontend/` is a minimal Next.js app that hosts `app/tracking`.
  - It has a stand-in sidebar, the TH/EN and theme toggles, and the dev user switcher.
  - None of it is copied into the host. It lives outside `app/tracking/`, in `app/(dev)/` and the root layout.
- **Server-side prefetch:** not used, because the host's auth for server-side fetches is unknown. The board is fetched client-side, behind a skeleton that matches the final layout so CLS stays 0.

- **Routes:**
  - `/tracking`: projects list.
  - `/tracking/[projectId]`: board.
  - The card detail opens as a side panel driven by `?card=<id>`, so links are shareable and Back closes it.
- **One route table** drives the sidebar and `aria-current`. Dashboard, Import and Reports are left out until they are built.
- **Data:**
  - TanStack Query. One board query per screen, revalidated by ETag.
  - Moves are optimistic: patch the cache, revert on error, and show an error toast with Retry.
  - Card detail data is prefetched on hover or focus.
- **Drag and drop:** dnd-kit (sortable lists and cards), with a thin wrapper and memoised card content. Alt + arrow keys move items. Screen-reader announcements are in both languages.
- **Markdown:** `react-markdown` with no raw HTML, for the description and comments. The @mention picker lists project members.
- **i18n:** a `TEXT` dict per component, and `useLang()` on one store. Dates use `th-TH` (Buddhist era) or `en-US`. Language, theme and split are saved in `localStorage` (preferences only).
- **Local dev user switcher:** visible only when `NEXT_PUBLIC_ENV=local`. It sets the `X-User-ID` header on API calls, so permissions can be tested as admin, PM, member or viewer.
- **Visual reference:** `index.html`. That covers card style, colours (`--s-*`, `--p-*`, `--pb-*`), Noto Sans Thai, the compact type scale, and the loading, empty and error states.

### Verification

- **Backend:** `go build ./... && go vet ./... && go test ./...` and `gofmt -l .` (empty). Tests cover:
  - services (rules, permissions per role, rank, last-PM guard, `completed_at`) against the memory store;
  - handlers through `httptest`, including the error envelope and 304.
- **Frontend:** `npx tsc --noEmit`, `npx next build`, and unit tests for the API wrapper and i18n.
- **Manual:** run both services. Check in both languages, both themes, desktop and phone width, and as each dev user.
- **Performance (builder's call):** the frontend half of the performance gate applies in P1.
  - Use a seed flag for 2,000 cards.
  - Measure LCP and CLS in a Lighthouse run on the board.
  - Capture a React Profiler run of a drag.
  - Quote the route JS sizes.
  - `EXPLAIN` and the API p95 move to the owner's PostgreSQL work, because they cannot be measured against the memory store.
- **Done list:** when the list with `is_done` changes, `completed_at` is recomputed in the same transaction for the cards in that list.

## Left to the builder

- Package-internal structure, component breakdown, file names.
- Seed data details (mirror the prototype's projects and cards).
- Exact validation limits. Use the ERD defaults: title 200, description 20,000, comment 5,000, checklist 500.
- Which shadcn components to add.
