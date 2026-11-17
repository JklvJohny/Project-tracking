---
name: tracking-performance-ux
description: Use when building, reviewing or optimising any Project Tracking screen or API - board, lists, cards, drag and drop, card detail panel, projects list, dashboard, timeline, import, reports - or when something is slow, janky, flickers, shifts layout, spams toasts, ships a heavy bundle, or looks inconsistent. Complements the project-tracking conventions skill.
---

# Project Tracking: fast, good-looking, easy to use

Design target: a board of **2,000 cards in ~10 lists, 50 people at once**. Every
screen is built to the budgets below and proved against them. Conventions
(i18n, roles, error codes) live in the `project-tracking` skill; this skill
decides **how data moves, how the screen renders, and how it feels**.

## 1. Budgets (the definition of "fast")

| Metric | Budget | Measured with |
|---|---|---|
| Board API `GET /projects/{id}/board`, 2,000 cards | p95 < 150 ms server time, < 250 KB gzipped | `EXPLAIN (ANALYZE, BUFFERS)` + `hey`/`k6` |
| Write APIs (move, patch, toggle) | p95 < 50 ms | same |
| Board route first load | LCP < 2.0 s, CLS < 0.05 | Lighthouse (mobile throttling) |
| Any interaction (drag drop, open card, type) | INP < 150 ms; drag at 60 fps | Chrome Performance panel, React Profiler |
| Route JS (first load, gzipped) | < 180 KB per route | `next build` output / bundle analyzer |

A change that touches a screen states which budget it affects and the measured
number before and after. No number = not done.

## 2. Server: one request per screen, small and cacheable

- **One endpoint per screen view**, a fixed number of queries regardless of
  size (no per-card queries). Run them in one `REPEATABLE READ, READ ONLY`
  transaction so the snapshot is consistent.
- **Summary payload only.** Board cards carry id, listId, title, position,
  priority, dueAt, checklist done/total, comment count, `assigneeIds`,
  `labelIds`. Users and labels are sent **once** as dictionaries. Description,
  comments, attachments load with the card detail.
- **Compression on** (`middleware.Compress`) for JSON responses.
- **ETag on reads**: hash `max(updated_at)` + row count of the board's lists
  and cards (+ the caller's role); answer `304 Not Modified` to `If-None-Match`.
  Re-opening a board that did not change costs no payload. This is only correct
  if **every child write (comment, checklist item, assignee, label) bumps its
  card's `updated_at` in the same transaction**; a write that forgets serves a
  stale board forever.
- Every query used by a screen has an index that `EXPLAIN` shows being used:
  `lists(board_id, position)`, `cards(list_id, position)` (a board loads
  cards through `JOIN lists`; `cards` has no `board_id`),
  `card_assignees(user_id)`, `checklist_items(card_id)`, `comments(card_id)`.
- Aggregates (checklist progress, comment counts) start as `GROUP BY` subqueries
  scoped to the board. Switch to counter columns maintained in the same
  transaction **only when** the board query misses its budget.
- Writes touch one row where possible (LexoRank `position text COLLATE "C"`),
  compute the new key on the server under a lock on the target list, and publish
  the realtime event **after commit**. A background job rebalances a list's
  keys when any key grows past 32 characters.

## 3. Client data: one cache, patched, never refetched wholesale

Use TanStack Query as the single client cache.

```tsx
// page.tsx (server): prefetch and stream the board into the shared cache
export default async function Page({ params }) {
  const { projectId } = await params;
  const qc = new QueryClient();
  await qc.prefetchQuery({ queryKey: ['board', projectId], queryFn: () => getBoard(projectId) });
  return <HydrationBoundary state={dehydrate(qc)}><BoardView projectId={projectId} /></HydrationBoundary>;
}
```

- Every route has a `loading.tsx` whose skeleton has **the same layout boxes**
  as the real screen (column widths, card heights), so nothing shifts on arrival.
- **After a write, patch the cache entry you changed** with `setQueryData`: the
  card in `['card', id]` *and* its summary inside `['board', projectId]`. Never
  `invalidateQueries(['board', …])` after a single-card edit: that refetches
  2,000 cards to change one title.
- **Open things instantly from what is already loaded.** The card panel renders
  from the board summary at once (`placeholderData` from the board cache) and
  fills in description, checklist and comments when the detail arrives.
- Prefetch on intent: `onPointerEnter` / `onFocus` of a card or project row calls
  `queryClient.prefetchQuery` for its detail.
- Realtime events are **nudges**: apply small events (card moved, title changed)
  straight into the cache; for anything else refetch only the affected key. A
  tab that was hidden refetches the board once on `visibilitychange`, with the ETag.
- Filters, search, the open card and the selected tab live in the URL
  (`?card=`, `?status=`, `?q=`); derived lists are computed with `useMemo`, not
  refetched. Search input is debounced 150 ms. Changing one param keeps the
  others: build links from the current `URLSearchParams`, never `href="?card=…"`
  alone (that silently clears the user's filters).

## 4. Rendering: only what changed re-renders

- Board state is split: `cards` (a `Map` by id, data) and `order`
  (`Record<listId, cardId[]>`). A move replaces only the arrays of the two lists
  it touches.
- `ListColumn` and the card's **visual content** are `memo` components with
  stable props (ids, primitives, memoised callbacks).
- **dnd-kit:** `useSortable` re-renders on every drag frame. Keep the sortable
  item a thin wrapper (ref, transform, listeners) and put the card's content in a
  separate `memo` child that does not read dnd-kit context, so a drag repaints
  positions, not 2,000 cards' content. Use `DragOverlay` for the moving card.
- Off-screen cards: `content-visibility: auto` with `contain-intrinsic-size`
  matching the card height. Add `@tanstack/react-virtual` only when a single
  list exceeds ~300 cards.
- No per-render allocation in hot paths: create `Intl.DateTimeFormat` objects
  once per language at module level, compute `now` once per board render and
  pass it down, never `new Date()` inside each card.
- Animate only `transform` and `opacity`. Never animate `width`, `height`,
  `top`, or box-shadow on many elements at once.

## 5. Bundle: pay only for what the screen shows

- Before adding a dependency, check its gzipped size (bundlephobia or the build
  output) and say it in the change. Prefer what Next, React, Tailwind and shadcn
  already provide.
- **Load heavy, occasional features on demand** with `next/dynamic`: the
  markdown editor/preview, charts, the XLSX reader, the PDF viewer, the import
  wizard. The board and card panel's first paint must not include them.
- Import icons by name (`import { Flag } from 'lucide-react'`); fonts through
  `next/font` (Noto Sans Thai, `display: 'swap'`, subsets `thai` + `latin`).
- Images and avatars have explicit `width`/`height`; avatars fall back to
  initials, so a slow image never moves the layout.

## 6. Feedback: match the response to the action

| The user… | Feedback | Not |
|---|---|---|
| drags a card, ticks a checkbox, edits a field inline | The change itself, at once (optimistic). A quiet inline "Saving…/Saved" next to the field. | A success toast |
| …and the save fails | Revert that one change + error toast with **Retry** (one toast id per object, so failures don't stack) | Silent revert |
| runs a command whose result is off-screen (create project, import 20 cards, bulk assign, archive) | Success toast with a next step: **Open**, **Undo** | A modal |
| does something reversible (archive card, remove checklist item) | Do it, toast with **Undo** | A confirm dialog |
| does something irreversible (delete project, delete document) | Confirm dialog, focus on Cancel, then toast | Just doing it |
| waits > 300 ms | Skeleton in the final layout, or a spinner inside the button that was pressed | Blank screen, full-page spinner |

## 7. Visual system (how "beautiful" is achieved)

- **Tokens only** (shadcn CSS variables, Tailwind theme): colour, radius
  (`rounded-md` for controls, `rounded-lg` for cards and columns, `rounded-xl`
  for panels), spacing on the 4 px scale. One-off values are a bug.
- **Type scale** is the compact one in the theme; body 13 px, titles by weight
  before size; Noto Sans Thai for both languages; line-heights leave room for
  Thai vowels and tone marks.
- **Hierarchy by weight and colour, not boxes**: muted text for metadata, one
  primary action per view, borders `border-border`, shadow only for things that
  float (drag overlay, popovers, panels).
- **Density**: a card shows title + at most one row of metadata (labels,
  priority, due, checklist, comments, avatars ≤ 3 then `+n`). Everything else is
  in the panel.
- **Status never by colour alone**; icon + text, colours from the validated
  `--s-*` (status) and `--p-*` (priority) tokens.
- **Tailwind classes are written out in full.** Tailwind only generates classes
  it finds as literal text, so `` `text-[var(--p-${priority})]` `` produces no CSS.
  Map values to complete class strings in a lookup object
  (`{ urgent: 'text-[var(--p-urgent)]', ... }`) or use an inline `style` for
  token-driven values.
- dnd-kit's screen-reader `announcements` and `screenReaderInstructions` are
  translated like every other string.
- **Motion**: 150–200 ms, `ease-out`, transform/opacity only, and a
  `motion-reduce:` fallback on every animation.
- Every empty state: one sentence of what goes here + one primary action.
- Both themes and both languages are designed, not just switched: check Thai
  text length (often 20–40 % longer) does not wrap headers or buttons.

## 8. Easy to use

- **Direct manipulation first**: inline edit (click title to edit, Enter saves,
  Esc reverts), drag to move, autosave fields; explicit Save only for long text.
- **Keyboard path for every pointer action**: `/` search, `N` new card in the
  focused list, Enter open, Esc close/revert, Alt+arrows move a card or list,
  Ctrl/⌘+Enter submit long text.
- **Undo beats confirm** for anything reversible (see §6).
- **Sensible defaults**: new card lands in the list you were in, assigned to
  nobody, priority Medium; new project dates default to today.
- **Never a dead control**: a disabled button says why (tooltip/text); a submit
  validates and points at the field instead of being disabled.
- **Remember the user's view**: open card, filters, board/timeline split,
  language and theme survive reload (URL or preferences).

## 9. Before calling a screen done

1. Seed a board with **2,000 cards / 10 lists / 20 users**.
2. Quote: board API timing and `EXPLAIN` plan, `next build` route sizes,
   Lighthouse LCP/CLS, and a React Profiler capture of one drag showing which
   components re-rendered.
3. Check every row of the budgets table; any miss is fixed or written down as
   a known gap with the number.
4. Look at it in light + dark, Thai + English, at 400 px and desktop width.

## Common mistakes this skill exists to stop

| Mistake | Fix |
|---|---|
| `invalidateQueries(['board'])` after editing one card | `setQueryData` on the card and its board summary |
| Card panel waits for its own fetch to show anything | Render from board summary, fill in detail |
| `react-markdown`/charts/xlsx in the first-load bundle | `next/dynamic` on open |
| Success toast on every drag or inline save | The visible change + inline "Saved"; toast only on failure |
| `cache: 'no-store'` full board on every visit | ETag + 304, hydrated cache |
| Every card re-renders during drag | Thin sortable wrapper + memo content child |
| `toLocaleDateString` / `new Date()` inside each card | Module-level formatter, `now` passed down |
| Skeleton with a different layout than the page | Skeleton built from the same column/card boxes |
| ETag that ignores comment/checklist/assignee writes | Child writes bump the card's `updated_at` in the same tx |
| `` className={`text-${x}`} `` built at runtime | Full class strings in a lookup, or inline `style` |
| `href="?card=id"` wiping the active filters | Build from current `URLSearchParams` |
