---
name: project-tracking
description: Conventions for the Project Tracking app (Go tracking-service + PostgreSQL backend, Next.js + Tailwind + shadcn/ui frontend) - Thai/English for every string, status toasts and confirm dialogs, server-side permission checks per project role, stable API error codes, LexoRank ordering, free/self-hosted only, and the checks that must pass before work is called done. Use when adding, editing, or reviewing any code in this repository.
---

# Project Tracking conventions

Trello-style tracking for one department: Project > Board > List > Card (no Workspace level). The plan lives
in `Project Tracking System Plan (Scalable).md`; the clickable prototype is
`index.html` (use it as the visual and behaviour reference, not as code to port
line by line).

## Stack and constraints

| Part | Choice |
|---|---|
| Backend | One Go service, `tracking-service`: `chi` or `echo`, `sqlc` + `pgx`, `goose` migrations, `asynq` (or a job table) for background work. Packages split by responsibility: `project`, `board`, `card`, `search`, `report`, `import`, `document`, `activity`, `notification`, `realtime`. |
| Database | PostgreSQL, its own schema. No other service reads tracking tables, and tracking reads no one else's. |
| Frontend | Next.js App Router + TypeScript + Tailwind + shadcn/ui. |
| Contract | OpenAPI spec is the source of truth; generate the TS client (`openapi-typescript` or `orval`). |

- **Free, open-source, self-hosted only.** No paid cloud APIs or SaaS, including
  for AI. If a feature seems to need one, stop and ask.
- **PO extraction with OCR/LLM is parked** (2026-11-17). Do not build it until
  asked. The prototype's PO import is simulated on purpose.
- Scope order follows the plan's phases: P1 (project, board, list,
  card, drag & drop, card details) before anything else.

## 1. Every user-facing string is Thai and English

A hardcoded string in one language is a bug. Each component declares its own
dictionary and reads the live language:

```tsx
const TEXT = {
  th: { title: 'โปรเจกต์', empty: 'ยังไม่มีโปรเจกต์' },
  en: { title: 'Projects', empty: 'No projects yet' },
} as const;

const [lang] = useLang();
const t = TEXT[lang];
```

- Also translate `aria-label`, `title`, `alt`, `placeholder` and every error message.
- **Never store a finished translated string in state.** Store a key or a
  `{ th, en }` pair and resolve it at render, or the text freezes in the old
  language when the user switches.
- `useLang()` / `useTheme()` read one store (`useSyncExternalStore`) so every
  component switches together. Do not copy the value into local `useState`.
- Dates use `th-TH` (Buddhist-era year) in Thai and `en-US` in English.
- Not translated: user content (card titles, comments, file names, project and
  label names) and proper nouns.

## 2. Mutations report, decisions ask

- Every mutation gives feedback, success **and** failure. Which kind (visible
  change + inline "Saved", toast with Undo/Open, or confirm) is decided by the
  table in the `tracking-performance-ux` skill §6: drags and inline edits do not
  raise success toasts. Toasts take `{ th, en }`, never a finished string. One
  `<Toaster />` in the root layout.
- Anything destructive or hard to undo asks first through the shared
  `confirm({ title, body, confirmLabel, danger })` (shadcn `AlertDialog`), which
  resolves to a boolean. `danger: true` opens with focus on Cancel. Order:
  confirm, act, toast.
- Card moves are optimistic: update the UI at once, revert on failure, and offer
  Retry in the error toast. Archiving offers Undo instead of a confirm.

## 3. Permissions live on the server

Roles are per project: Project Manager, Member, Viewer (`project_members`).
Above that, `user_roles` holds only the exceptions: `admin` (everything) and
`manager` (may create projects, and becomes PM of each one it creates). There
is no Workspace level: one department uses the system.

- Hiding a button is presentation, not access control. **Every route checks the
  caller's role for that project on the server**, including file downloads.
- Ship the UI gate and the server check in the same change.
- Auth is the existing system's: the gateway/middleware validates the token and
  passes `user_id`. tracking-service has no login and stores only `user_id`;
  names and avatars come from user-service (cached in `user_cache`).
- The `X-User-ID` fake middleware exists **only** in the `local` env. It must
  never be reachable in production: anyone could act as anyone.
- Nothing about the account goes in `localStorage`. Only preferences
  (language, theme, board/timeline split) may.

## 4. API errors carry a code

Failures answer `{ success: false, error, code }`. `error` is English for logs;
`code` is what the UI switches on (`forbidden`, `not_found`, `bad_request`,
`conflict`, `server_error`, ...). Add the Thai and English text for a new code
in the same change. The frontend matches on `.code`, never on message text, and
treats "no response" as its own case (`network_error`).

Client-side checks mirror server limits to save a round trip; they never
replace server validation. File uploads are type- and size-checked on the server.

## 5. Data rules

- **Ordering uses LexoRank / fractional keys** (`position text`) for lists,
  cards and checklist items. Moving one card updates one row.
- Every mutation writes its `activity_events` row **in the same transaction**.
- Bulk work (import, bulk assign) is one request and one transaction, never a
  loop of requests from the browser that can stop half way.
- Files never go in the database: `./uploads` first, MinIO later; the DB keeps
  `storage_key`, name, size and type. Files are served through an
  authorised route or a short-lived signed URL, never a public folder.
- Validation for a write lives in one function per entity, used by both create
  and update, so an edit cannot bypass a rule the create enforces.
- What identifies a row gets a unique index, not only a service check.

## 6. Frontend structure

- Every section is a real route (`/tracking`, `/tracking/[projectId]`,
  `/tracking/dashboard`, `/tracking/import`, `/tracking/reports`). The URL decides
  what is on screen; no `useState` for "which page".
- One route table drives the sidebar, tabs, `aria-current` and the role guard.
- A page's own parts live in `components/` beside its `page.tsx`; what several
  pages share goes in `app/tracking/shared/`.
- Colour only through the shadcn CSS variables / Tailwind tokens; no raw hex in
  components. Chart series colours are validated tokens (`--s-*`, `--p-*`).
- Navigate with `<Link>`, not `router.push` in `onClick`.

## 7. Accessibility and layout

- `aria-label` on every icon-only control (translated); visible `:focus-visible`
  rings; `aria-hidden` on decorative SVG.
- Form errors: message with `role="alert"`, `aria-invalid` on the field, focus
  moves to the field. Use `noValidate` and validate in code; do not disable a
  submit button just because a field is empty.
- Status is never colour alone: priority, due state and labels carry an icon or text.
- Keyboard: cards and lists movable with Alt + arrows; dialogs trap focus and
  close on Escape.
- Every animation has a `prefers-reduced-motion` escape.
- Responsive from 400px wide to large desktop. A grouped table is one `<table>`
  with heading rows, not one table per group.

## 8. Comments

Comments say **why**: the decision or the failure being prevented. No narration,
no commented-out code.

## 9. Before calling anything done

Run them and quote the output. "Should work" is not a result.

```bash
# frontend
npx tsc --noEmit
npx next build

# tracking-service
go build ./... && go vet ./... && go test ./...
gofmt -l .        # must print nothing
```

Then look at the change in the running app in **both themes** and **both
languages**, at desktop and phone width.
