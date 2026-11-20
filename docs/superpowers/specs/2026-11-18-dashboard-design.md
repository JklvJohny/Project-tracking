# Dashboard: design

Date: 2026-11-18. Status: approved by the owner ("ทำแดชบอร์ดต่อเลย", go ahead). This follows the prototype's Dashboard view in `index.html`.

## Intent

A one-page overview of open work across the projects the caller can see: how much is open and overdue, what is due soon, who is overloaded, and which deadlines are close.

## What the page shows (prototype layout)

- **Route:** `/tracking/dashboard`. The sidebar "Dashboard" entry becomes a live link. Import stays "coming soon".
- **Header:**
  - The title "Dashboard" with "as of <date>". The date is today in Asia/Bangkok, from the server.
  - A project scope select: "All projects" or one project, kept in `?project=`.
  - An "Import tasks" button, disabled with "coming soon".
- **Stat tiles:**

  | Tile | Value | Note under the value |
  |---|---|---|
  | Open tasks | count | "N in progress" |
  | Overdue | count | — |
  | Due in 7 days | count | — |
  | Unassigned | open tasks with no assignee | — |
  | Completion | done ÷ total, shown as % | a bar, and "X of Y tasks done" |

- **Tasks by project:** one stacked bar per project, split into done, in progress, not started and overdue, with the total at the end. A "View as table" toggle shows the same numbers as a table.
- **Workload by person:** one stacked bar per person, covering open tasks only (in progress, not started, overdue), with an avatar and a total. People with no open tasks show "No tasks". There is a "View as table" toggle.
- **Open tasks by priority:** a bar per priority (urgent, high, medium, low), coloured with the `--p-*` tokens and labelled with icon and text.
- **Deadlines:** overdue cards and cards due in the next 14 days, soonest first, at most 20.
  - Each row shows a relative label ("2d overdue", "Today", "in 3d"), the title, "Project · List" and assignee avatars.
  - Clicking a row opens the card at `/tracking/<projectId>?card=<id>`.
- **States:** loading skeleton (no layout shift), empty ("No projects yet" or "No open tasks"), error with Retry. Thai and English, light and dark, 400px to desktop.

## Status rules

These are the same rules the Timeline uses, so the two never disagree:

| Status | Rule |
|---|---|
| done | `completedAt` is set |
| overdue | not done, and `dueDate` < today |
| in progress | not done, not overdue, and `startDate` ≤ today |
| not started | everything else |

- "Open" means not done.
- "Due in 7 days" means open, and today ≤ due ≤ today+7.
- The data covers only active cards in active lists of non-archived projects the caller can see. An admin sees all projects; everyone else sees projects they are a member of.

## Backend

**Endpoint:** `GET /api/tracking/v1/dashboard?projectId=<id>`. `projectId` is optional. A project the caller cannot see answers `not_found`. The response:

```
{ asOf: "YYYY-MM-DD",
  totals: { total, done, open, inProgress, notStarted, overdue, dueSoon, unassigned },
  byProject: [{ id, name, done, inProgress, notStarted, overdue, total }],
  workload: [{ user:{id,name,avatarUrl}, inProgress, notStarted, overdue, open }],
  byPriority: [{ priority: "urgent"|"high"|"medium"|"low", open }],
  deadlines: [{ cardId, projectId, projectName, listName, title, dueDate, daysLeft, assignees:[{id,name,avatarUrl}] }] }
```

**Ordering:**
- `byProject`: by name.
- `workload`: every member of the scoped projects, ordered by `open` descending, then by name.
- `byPriority`: all four priorities, always present.

**Store:** a new repo method `Dashboard.Rows(ctx, projectIDs []int64) ([]store.DashboardRow, error)` makes one query. Each row carries the card id, project id and name, list name, title, priority, start date, due date, `completedAt` and assignee ids. Aggregation happens in Go, in a pure function `dashboard.Build(rows, members, users, today)` that is unit-tested. The SQL obligation goes in the repo doc comment and in `docs/db-contract.md`.

**Today:** the clock converted to Asia/Bangkok (`time.LoadLocation("Asia/Bangkok")`, falling back to a fixed `+07:00` zone), which matches the ERD ruling. The permission is View on each project.

## Frontend

- **Files:** `app/tracking/dashboard/{page.tsx, StatTiles.tsx, StackedBars.tsx, PriorityBars.tsx, Deadlines.tsx, queries.ts, *.test.tsx}`.
- **Data:** TanStack Query key `['dashboard', projectId|null]`.
- **Charts:** plain CSS bars, not a chart library, because they are small and need to be fast.
  - Colours come from the validated `--s-*` and `--p-*` tokens.
  - Each chart has a legend with an icon and text, so colour is never the only signal.
  - Each bar segment has an accessible label with its counts.
  - The "View as table" toggle gives a real `<table>` alternative.
  - Follow the dataviz skill's rules for marks, legends and dark mode.

## Non-goals

Date-range pickers, CSV export, trend lines, real-time refresh, and the Import feature.
