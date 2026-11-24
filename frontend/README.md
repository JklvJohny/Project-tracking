# Project Tracking frontend

Next.js 16 (App Router, React 19), Tailwind 4, shadcn/ui. The tracking code lives only in `app/tracking/**`; the rest
of this project (`app/(dev)`, `app/layout.tsx`, `app/page.tsx`) is a local harness standing in for the host app.
To move tracking into the host, read [`../docs/host-integration.md`](../docs/host-integration.md).

The Go service it talks to is in `../backend` (API contract: `../backend/api/openapi.yaml`).

## Run locally

```sh
# 1. backend (port 8081). SEED_LARGE=1 adds the "Load Test" project: 8 lists, 2,000 cards.
cd backend
ENV=local SEED_LARGE=1 go run -tags local ./cmd/tracking-service

# 2. frontend (port 3000)
cd frontend
npm install
npm run dev
```

`/api/tracking/*` is proxied to `TRACKING_API_URL` (default `http://localhost:8081`) by the rewrite in `next.config.ts`.
Open `http://localhost:3000/tracking`. The dev shell has a language switch (TH/EN), a theme switch, and a dev-mode
user switcher (dev users 1 to 8, see `../backend/README.md`).

### Dev mode

Dev mode shows the user switcher in the header. It is off by default, so screens look like the host app.

| Shortcut | Effect |
|---|---|
| `Ctrl` + `Shift` + `B` | Turn dev mode on (show the user switcher) |
| `Ctrl` + `Alt` + `Shift` + `B` | Turn dev mode off (hide the user switcher) |

- The choice is kept in `localStorage` (`pt-dev-mode`), so it survives a reload.
- Hiding the switcher does not log you out. Requests keep using the last chosen dev user (`sessionStorage` `pt-dev-user`, default user 2).
- The shortcuts work with the Thai keyboard layout, because they match the physical `B` key.

Dev mode exists only when `NEXT_PUBLIC_ENV=local`. In any other build the shortcuts do nothing and no `X-User-ID`
header is sent. `next dev` sets the variable by default; a production build does not, so build with the variable when
you need dev mode on `next start`:

```sh
NEXT_PUBLIC_ENV=local npx next build && npx next start
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server, on `127.0.0.1` only (the dev shell sends an `X-User-ID` header, so it must not be reachable from the network). |
| `npm run build` / `npm start` | Production build and server. |
| `npm test` | Vitest (jsdom). |
| `npx tsc --noEmit` | Type check. |
| `npm run gen:api` | Regenerates `app/tracking/shared/api/schema.d.ts` from `../backend/api/openapi.yaml`. |

The gate before a commit: `npx vitest run && npx tsc --noEmit && npx next build`, with no warnings in the test output.

## Pages

| Route | What it shows |
|---|---|
| `/tracking/dashboard` | Dashboard: stat tiles (open, overdue, due in 7 days, unassigned, completion), tasks by project and workload by person as stacked bars (each with a "View as table" toggle), open tasks by priority, and the next 14 days of deadlines (click one to open its card). `?project=<id>` scopes it to one project. Data comes from `GET /dashboard`; "today" is the server's Bangkok date. |
| `/tracking` | Projects (list and grid views, owner, members, progress). |
| `/tracking/<id>` | Board with header, collapsible board section, and an optional Timeline (bars grouped by assignee, resizable split). `?card=<id>` opens the card panel; `?card=<id>&focus=checklist` focuses the checklist input. |
| `/tracking/reports` | Reports: project folders with document counts, a document table, upload (button or drag and drop, PDF only, 20 MB), a PDF viewer (double-click or Enter; arrows move between files), download, delete with Undo. `?project=<id>` opens a folder. Members delete only their own files; archived projects are read-only. |

Reports needs the backend's `UPLOAD_DIR` (default `./uploads`); see `../backend/README.md`. The viewer loads the PDF
with the request headers and shows it from an object URL, see section 3 of `../docs/host-integration.md`.

## Performance results

Measured on 2026-11-18 against the production build (`NEXT_PUBLIC_ENV=local npx next build && npx next start`),
backend started with `SEED_LARGE=1`, board `http://localhost:3000/tracking/3` (Load Test, 2,000 cards, user 2),
Windows 11, installed Chrome, headless, no CPU throttling.

| Metric | Budget | Result |
|---|---|---|
| LCP (Lighthouse 13.6, desktop preset, 3 runs) | < 2 s | 0.9 s, 0.8 s, 0.8 s |
| CLS | < 0.1 | 0 in all 3 runs |
| Total blocking time (informational) | | 190 to 500 ms (noisy, 2,000 cards hydrate in one go) |
| Route JS, gzip, whole first load of `/tracking/[projectId]` | < 180 KB | 289 KB, see note |
| Route JS, gzip, chunks only this route loads | | 49 KB |
| Drag frames (2,000 cards, one cross-list drag), p50 / p95 | | 7 ms / 14 to 21 ms (2 runs) |
| Longest tasks during that drag | | one 320 to 520 ms task when the drag starts (dnd-kit measures all 2,000 rows), then 55 to 190 ms tasks |

Lighthouse command (Chrome path via `CHROME_PATH`):

```sh
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
  npx lighthouse http://localhost:3000/tracking/3 --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new"
```

Route JS note. `next build` in Next 16 no longer prints per-route sizes, so the figure is the sum of the gzip sizes of
the script chunks the page's HTML references:

```sh
for f in $(curl -s localhost:3000/tracking/3 | grep -o '_next/static/chunks/[^"]*\.js' | sort -u); do
  curl -s localhost:3000/$f | gzip -9 | wc -c
done   # sum the numbers
```

That gives 289 KB for the board, 250 KB for the projects list and 240 KB for `/_not-found`. About 240 KB is the shared
baseline every page of this app pays (React 19, the Next client, and the provider with React Query, toasts, tooltip and
dialogs); the board adds 49 KB on top. The 180 KB budget is therefore not met as a whole-page number. The host app
already ships React and Next, so the cost tracking adds there is nearer the 49 KB plus the provider. Already done to
keep it down: the card panel, members dialog and settings dialog are loaded on demand with `next/dynamic`, which
moved the markdown renderer and the pickers out of the first load (350 KB before, 289 KB now).

Rulings recorded for P1:

- R12: the 289 KB first-load route JS against the 180 KB budget is accepted. About 240 KB is the shared React/Next/provider baseline the host app already ships; the route-only 49 KB is within budget.
- R13: about 700 `SortableCard` shell re-renders per drag commit are accepted. Measured p95 frame time is 14 to 21 ms on 2,000 cards, within the INP budget; virtualisation is deferred.

### What the drag profile found, and the fixes

Method. `React.Profiler` is not available in a production build, so the commits were counted through the React
DevTools global hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`), counting function-component fibers that did
render work, with unchanged subtrees pruned as DevTools does. Frame times come from a `requestAnimationFrame` loop and
a `longtask` observer, both injected with Playwright into the installed Chrome (`playwright-core`, no browser download),
plus a CDP CPU profile and trace. One drag: pick up the first card of list 1, move it into list 2 and drop (46 commits).

| | Before | After |
|---|---|---|
| Frame time p95 during the drag | 132 ms | 14 to 21 ms |
| Compositor "Layerize" work in the trace | 2,391 ms | about 360 ms |
| Card rows re-rendered (`CardPreview`) | every card on every commit | 2 to 10 in the whole drag |
| List row groups re-rendered | all 8 lists on every commit | 8 to 20 in the whole drag (the two affected lists, when the preview changes) |

Causes and fixes:

1. dnd-kit gives every sortable row an identity `translate3d(0,0,0)` while dragging, which made 2,000 compositor
   layers. Rows now get a `transform` only when they are really shifted (`isShifted` in `board/dnd.tsx`).
2. `ListColumn` re-renders on each pointer move because its sortable hooks subscribe to dnd-kit's context. Its rows
   moved into a memoised `ListCards` with an element-wise `cards` comparison, so the cards of lists the drag does not
   touch are not rebuilt.
3. `content-visibility: auto` on card rows (`.card-row` in `tracking.css`) skips layout and paint for off-screen rows.
4. List virtualisation was not needed.

What is left: every row shell (`SortableCard`, about 700 of them per commit, 32,000 over the drag) still re-renders,
because `useSortable` subscribes each row to dnd-kit's context and that context changes on every pointer move. Their
children are memoised so this is cheap, but it is what bounds the drag-start spike. Going further would mean
virtualising the lists or replacing `useSortable` for the cards.

## Manual verification

The pass in the task 18 report was done with scripted Chrome (Playwright, `playwright-core` with
`executablePath` set to the installed Chrome): TH/EN x light/dark x 1440 px/400 px as users 1 (admin), 2 (manager),
3 and 6 (members). The match-prototype pass (projects, board with Timeline, card panel, Reports) was done the
same way and compared with screenshots of `../index.html`. The scripts are not kept in the repo.
