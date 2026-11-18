# Match Prototype + Timeline + Reports Implementation Plan

> **For agentic workers:** Execute task-by-task with superpowers:subagent-driven-development. **Owner decision (2026-11-18): no per-task review.** Each task runs its own tests. One whole-branch review plus a real-Chrome pass runs at the end (Task 9).

**Goal:** Make every P1 screen look like `index.html`, and build the Timeline (Gantt) and Reports features for real.

**Architecture:**
- The work stays on branch `feat/tracking-p1`.
- **Backend:**
  - adds read fields: projects list summary, card checklist preview;
  - adds a `document` module with a `blob.Store` (local disk) and a `Documents` repo with an in-memory implementation.
- **Frontend:**
  - restyles the existing components in place;
  - adds `app/tracking/board/timeline/*` and `app/tracking/reports/*`.

**Tech Stack:**
- **Backend:** Go/chi.
- **Frontend:** Next.js 16, TanStack Query, dnd-kit, shadcn, Tailwind 4.
- **Tests:** vitest, Go test.

**Spec:** `docs/superpowers/specs/2026-11-18-match-prototype-design.md`. It binds every task; read the relevant section of it.

## Global Constraints

- **P1 conventions still apply:**
  - Read `D:/YTH_WORKS/Project_tracking/.superpowers/sdd/2026-11-17-tracking-p1/global-constraints.md`, including rulings R1–R15.
  - Also read `.claude/skills/project-tracking/SKILL.md` and `.claude/skills/tracking-performance-ux/SKILL.md`.
- **Buttons keep the current neutral shadcn primary.** Do not recolour them.
- **Every string is a th/en `TEXT` entry.** That includes aria-labels and the "coming soon" tags.
- **No raw hex in components.** Use tokens only. New colour tokens go in `app/tracking/tracking.css` for light and dark.
- **Request bodies use `satisfies S['…']` against the generated types.** After any API change, run `npm run gen:api`.
- **Archived projects are read-only** (R14), and that includes Reports uploads and deletes.
- **Gates for every task:**
  - backend: `cd backend && go test -tags local ./... && go vet -tags local ./... && gofmt -l .`
  - frontend: `npx vitest run && npx tsc --noEmit`
- **Run frontend commands from an upper-case `D:\` path.** On Windows, a lowercase `d:` cwd makes vitest load twice and every suite fails.
- **Commit rules:** one commit per task (Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never stage the unrelated deleted `reports/` and `tools/` files.
- **Visual reference:** `index.html`. Grep for the component you need; do not read the whole file. The prototype's screenshots are in the controller scratchpad: `cmp-proto-*.png` in `C:/Users/tripl/AppData/Local/Temp/claude/53d88e2cfbab76e9/14764d43-0eba-4337-99f9-0f3bcebdfe82/scratchpad/`.

---

### Task 1: Backend read additions (projects summary, checklist preview)

**Files:**
- `backend/internal/store/{entities.go,repos.go}`
- `backend/internal/store/memory/*`
- `backend/internal/project/{service.go,handlers.go}`
- `backend/internal/board/service.go`
- `backend/api/openapi.yaml`
- `docs/db-contract.md`
- `frontend/app/tracking/shared/api/schema.d.ts` (regenerated)

**Produces:**
- **`GET /projects` items** gain:
  - `owner {id,name,avatarUrl}`;
  - `members [{id,name,avatarUrl}]`, ordered pm first, then by name;
  - `cardsDone` and `cardsTotal` (active cards; done means `completedAt != null`).
- **A new repo method** `Projects.Summaries(ctx, projectIDs []int64) (map[int64]store.ProjectSummary, error)`:
  - one call, no N+1;
  - SQL obligation in its doc comment and in `db-contract.md`.
- **Board snapshot card summaries** gain `checklistPreview [{id,text,isDone}]`: the first 3 items by position, never nil.

**Tests:**
- `TestList_IncludesOwnerMembersProgress`
- `TestSnapshot_ChecklistPreviewFirstThreeByPosition`
- empty-array (non-nil) cases
- The routes/openapi test stays green.

---

### Task 2: Backend `document` module (Reports storage)

**Files:**
- `backend/internal/blob/{blob.go,local.go,local_test.go}`
- `backend/internal/document/{service.go,handlers.go,*_test.go}`
- `backend/internal/store/{entities.go,repos.go}`: `Document` entity and `Documents` repo
- `backend/internal/store/memory/document_repo.go`
- `backend/internal/config/config.go`: `UPLOAD_DIR`, default `./uploads`
- `backend/cmd/tracking-service/main.go`: wiring
- `backend/api/openapi.yaml`, `docs/db-contract.md`, `backend/README.md`
- `.gitignore`: add `backend/uploads/`

**Produces** (the endpoints, permissions and validation are exactly as in the spec section "Reports backend"):
- **Blob store:**
  - `blob.Store interface { Put(ctx, key string, r io.Reader) (int64, error); Open(ctx, key string) (io.ReadCloser, error); Delete(ctx, key string) error }`
  - `blob.NewLocal(dir string)` rejects keys that escape `dir`.
- **Document service:** `document.New(st store.Store, bs blob.Store, now clock.Clock)` and `document.Mount(r chi.Router, s *Service)`.
- **Behaviour:**
  - size cap 20 MiB via `http.MaxBytesReader`, so an oversize body answers `validation_failed {file: too_large}`;
  - `%PDF-` magic check, else `validation_failed {file: not_pdf}`;
  - server-generated key `<projectID>/<random>.pdf`.
- **Write ordering:**
  - Upload writes the blob first and then the row inside `store.Update`. If the row write fails, the blob is deleted.
  - Delete is soft: the row only. The blob is kept so restore works.
- **Download** sets `Content-Type: application/pdf`, `Content-Disposition: inline; filename*=UTF-8''<escaped>` and `X-Content-Type-Options: nosniff`.
- **Seed:** when `ENV=local` and `../reports/<folder>/*.pdf` exist on disk, import them into the matching seeded project (`website-redesign` → project 1, `mobile-app-v2` → project 2). Skip silently if absent.

**Tests:**
- `blob`: put/open/delete; a path-escape key is rejected.
- `document`:
  - upload OK (201);
  - non-PDF → `not_pdf`;
  - oversize → `too_large`;
  - viewer upload → 403;
  - non-member list/file → 404;
  - archived project upload/delete → 409 `project_archived`;
  - delete by a member who is not the uploader → 403;
  - uploader delete + restore;
  - the file endpoint streams the bytes with the headers above;
  - a blob is cleaned up when the row insert fails.

---

### Task 3: Frontend visual system, dev shell chrome, tracking tab bar

**Files:**
- `frontend/app/tracking/tracking.css`: tokens for status pills, avatar palette, board background
- `frontend/app/tracking/shared/{Avatar.tsx,AvatarStack.tsx,StatusPill.tsx,TrackingTabs.tsx}`
- `frontend/app/(dev)/DevShell.tsx`
- `frontend/app/tracking/layout.tsx`
- `frontend/app/tracking/shared/routes.ts`

**Produces:**
- **`Avatar`** `{user:{id,name,avatarUrl?}, size?: 'xs'|'sm'|'md'}`:
  - initials;
  - a deterministic colour from a token palette indexed by `id % N`, validated for white text contrast at AA.
- **`AvatarStack`** `{users, max=4}` with a `+N` overflow.
- **`StatusPill`** `{status: 'active'|'on_hold'|'done'|'archived'}` with the prototype's colours and a dot.
- **`TrackingTabs`:**
  - Dashboard, Projects, Reports, Import, each with an icon;
  - Projects and Reports are links using `aria-current`;
  - Dashboard and Import are disabled, with a translated "coming soon" tag (`aria-disabled`).
- **`DevShell`** looks like the prototype's host chrome:
  - **Header:** app mark, an EN/TH segmented toggle, a theme icon toggle, the current dev user's `Avatar`, and the dev user switcher (Ctrl+Shift+B behaviour unchanged).
  - **Sidebar:** a Tracking section (Dashboard and Import as disabled placeholders; Projects; Reports) and an Other section (a disabled Settings placeholder).

**Tests:** Avatar colour is deterministic; TrackingTabs disabled items are not links and carry the translated tag; existing DevShell tests stay green.

---

### Task 4: Projects page restyle

**Files:**
- `frontend/app/tracking/page.tsx`
- `frontend/app/tracking/projects/{ProjectsTable.tsx,ProjectsGrid.tsx,StatusBadge.tsx→StatusPill}`

**Produces** (prototype "Projects" screenshot):
- **Header:** title and count.
- **Status tabs:** with counts.
- **Table columns:** Project (name + description), Owner (Avatar + name), Status (StatusPill), Timeline, Members (AvatarStack), Progress (bar + `done/total`).
- **List/grid toggle:** kept in `?view=list|grid`. Grid shows cards with the same data.
- **Kept from before:** loading, empty and error states, and the role gating of New project.

**Tests:** columns render the Task 1 fields; the view toggle switches layout and updates the URL; the existing projects tests stay green.

---

### Task 5: Board header, placeholders, card preview restyle

**Files:**
- `frontend/app/tracking/[projectId]/page.tsx` (header)
- `frontend/app/tracking/board/{Board.tsx,ListColumn.tsx,CardPreview.tsx,BoardFilters.tsx,BoardSection.tsx}`

**Produces:**
- **Header:**
  - breadcrumb and back arrow;
  - large title, StatusPill and member AvatarStack;
  - Members and Settings buttons, as today;
  - an Import button, disabled with "coming soon";
  - an Archived button with the archived count from `qk.archived`, when loaded.
- **`BoardFilters`:** Search, Assignee, Label, Priority, Due, disabled with a "coming soon" tooltip and `aria-disabled`.
- **`BoardSection`:** a collapsible "Board · N lists · M cards" section. Its open state is saved in `localStorage` as `pt-board-open`.
- **Board area:** sits on the muted background token.
- **`CardPreview`:**
  - **Badges:** the priority badge and labels, as today.
  - **Title:** the title.
  - **Assignees:** an AvatarStack plus a dashed "+" button for editors that opens the existing AssigneePicker in a popover.
  - **Subtasks:**
    - a "N SUBTASKS" header with a "+" that opens `?card=<id>&focus=checklist`;
    - the first 3 `checklistPreview` items as checkboxes, toggled through the existing checklist mutation, with an optimistic patch of both caches;
    - "+N more" when there are more items.
  - **Meta row:**
    - a due chip with a calendar icon (overdue: red with a warning icon; completed: green with a check);
    - a comment icon and count.
  - The memoisation and drag behaviour stay intact. The checkbox and the "+" must not start a drag or open the card.

**Tests:**
- toggling a preview checkbox calls `PATCH /checklist/{id}` and updates `checklistDone`;
- the "+" assign opens the picker, and viewers see no "+";
- the placeholders are disabled and translated;
- BoardSection collapses and the state persists;
- the existing board and dnd tests stay green.

---

### Task 6: Card panel two-column layout + Status (list) select

**Files:** `frontend/app/tracking/card/{CardPanel.tsx,…}` (reuse the existing field components)

**Produces** (prototype card screenshot):
- **Size:** a wide sheet, about 900px, two columns at ≥768px and stacked below that.
- **Top bar:** a "Project / List" breadcrumb, an Archive button and Close.
- **Main column:** title (large), labels and priority inline, Description (Write/Preview segmented control), Checklist, Comments (author Avatar).
- **Side column:**
  - **Status (list) select:** moves the card to the END of the chosen list via the existing `useMoveCard`, with optimistic update and rollback;
  - Assignees with an Edit picker;
  - Priority select;
  - Start and Due dates;
  - Labels with an Edit picker;
  - "Created by <name> · Card ID <id>".
- **`?focus=checklist`** focuses the add-item input on open.
- **Kept from before:** all existing behaviour (Escape guard, flush-on-close R10, read-only rules, the 404 state).

**Tests:** the Status select moves the card (API call plus caches); `focus=checklist` focuses the input; the existing card tests stay green.

---

### Task 7: Timeline (Gantt) + resizable split

**Files:**
- `frontend/app/tracking/board/timeline/{Timeline.tsx,timeline-model.ts,timeline-model.test.ts,Timeline.test.tsx}`
- `frontend/app/tracking/board/Splitter.tsx`
- `[projectId]/page.tsx` (layout)

**Produces** (spec "Timeline"):
- **Model:** `buildTimeline(board, range, today) → {groups:[{assignee|null, rows:[{card, startPct, widthPct, kind:'bar'|'milestone', status:'done'|'active'|'todo'|'overdue'}]}], weeks:[{label, leftPct}], todayPct, undated:[card]}`. It is pure and tested.
- **Status rules:**
  - done = `completedAt` is set;
  - overdue = due is before today and the card is not done;
  - active = the start date has passed;
  - otherwise todo.
- **Rendering:**
  - groups by assignee, with an Unassigned group and a "No dates" list;
  - prev / next / today range controls (4 weeks by default);
  - bar colours from the `--s-*` tokens;
  - each bar shows its title text, and its `aria-label` carries the assignee, dates and status;
  - click opens `?card=<id>`.
- **Section:** a collapsible "Timeline" section. Its open state is saved in `localStorage` as `pt-timeline-open`.
- **`Splitter`:**
  - sits between Board and Timeline when both are open;
  - drag to resize; ArrowUp/ArrowDown adjust by 5%;
  - `role="separator"` with `aria-valuenow`;
  - the split ratio is saved in `localStorage` as `pt-split` (clamped 0.2–0.8).

**Tests:**
- model cases: bar, milestone, overdue, done, out of range, undated, and grouping by multiple assignees;
- Timeline renders bars with labels, and a click navigates;
- Splitter keyboard changes the ratio and persists it.

---

### Task 8: Reports page

**Files:**
- `frontend/app/tracking/reports/{page.tsx,FolderList.tsx,DocumentTable.tsx,DocViewer.tsx,UploadZone.tsx,queries.ts,*.test.tsx}`
- `routes.ts`, `TrackingTabs` (Reports is live)

**Produces** (spec "Reports page"):
- **Folders:** the folder list (projects the caller can see, with document counts) → `?project=<id>` → the document table (name, size, uploaded by, date). Rows are keyboard selectable with arrows.
- **Viewer:**
  - Double-click or Enter opens `DocViewer`: a dialog with an `iframe` to `/api/tracking/v1/documents/{id}/file`, prev/next (arrow keys) and Download.
  - Escape closes the viewer.
- **Upload:**
  - a button plus drag & drop, for editors only;
  - the client pre-checks PDF type and the 20 MB limit with translated messages;
  - the upload uses `FormData`, a progress state, and the server error codes (`too_large`, `not_pdf`) mapped in `errors.ts`.
- **Delete:** confirm first, then delete, then a toast with Undo (restore).
- **Read-only:** archived projects and viewers see no upload or delete controls.

**Tests:**
- the folder list → document table;
- double-click / Enter opens the viewer with the right src, and the arrows move;
- the client rejects non-PDF and oversize files with translated text;
- upload success adds the row;
- delete confirm → Undo restores;
- the viewer role has no upload.

---

### Task 9: Docs, real-Chrome pass, whole-branch review

**Steps:**
- **Docs:**
  - update `docs/host-integration.md`: new files and deps, the Reports route, `UPLOAD_DIR` for the backend;
  - update `frontend/README.md` and `backend/README.md`.
- **Real-Chrome pass** (Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` via playwright-core; scripts in the scratchpad):
  - screenshots of projects, board with Timeline, the card panel and Reports;
  - TH/EN × light/dark × 1440/400;
  - side-by-side against `cmp-proto-*.png`;
  - exercise Timeline, Reports upload, view, delete and Undo, and the reject cases.
  - Fix any defects found, with tests.
- **Full gates**, including `npx next build`.
- **Then** the controller runs one whole-branch review (opus) over this plan's range and one fix wave.
