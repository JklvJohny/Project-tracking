# DB contract: what the PostgreSQL `internal/store` must do

For the system owner, who writes the PostgreSQL implementation of `backend/internal/store`.
The in-memory store (`internal/store/memory`) is the reference: every service test runs against it,
so the PostgreSQL store must behave the same way for every method below. Schema: `docs/ERD.md`.
API shapes: `backend/api/openapi.yaml`.

Ground rules:

- Services never see SQL. They call the repo interfaces in `internal/store/repos.go` inside `Store.View` or `Store.Update`.
- Every id is `int64` (`bigint`), user ids included. User ids have no foreign key (they come from user-service).
- A missing row is `store.ErrNotFound`, never `sql.ErrNoRows` and never a nil value. Services map it to `not_found`.
- Dates are `DATE` and travel as `store.Date` (`"YYYY-MM-DD"`). Timestamps are `timestamptz`, handled in UTC: the services stamp every write with `clock.UTC` (wired in `main.go`), and the API emits them as `...Z`. Timestamps read back must be UTC too (run the session with `SET TIME ZONE 'UTC'`, or convert with `.UTC()` when scanning), or the JSON would carry the server's local offset.
- Slices a repo returns (`CardChildren.AssigneeIDs`, `LabelIDs`, `Checklist`, mention ids, list results) are empty, never nil, when there are no rows. The services guard the ones the API emits, but the contract is "never nil".
- Priority is `smallint` 0-3. The API never sees the number (`store.PriorityName`).
- Position keys (`lists`, `cards`, `checklist_items`) are LexoRank text from `internal/rank`: base-36 digits `0-9a-z`.
  Always compare them bytewise, so every `ORDER BY position` uses `COLLATE "C"`. A locale collation orders differently and breaks drag and drop.
- Soft-deleted comments (`deleted_at` set) stay in the table; archived projects, lists and cards stay too (`archived_at`).

## Transactions: `Store.View` and `Store.Update`

| | `View(ctx, fn)` | `Update(ctx, fn)` |
|---|---|---|
| Transaction | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` ... `COMMIT` | `BEGIN` ... `COMMIT`; `ROLLBACK` when `fn` returns an error |
| Why | One request sees one snapshot across several queries (the board is read as a unit). | A write, its activity event and its `updated_at` bumps become visible together or not at all. |
| Writes | Never. A write method inside `View` is a bug; the database should reject it because the transaction is read-only. | Allowed. |

- Do not nest. Calling `View` or `Update` inside a callback is a bug (the memory store deadlocks on it). Every `Repos` handed to `fn` is bound to that one transaction; the implementation must not open another connection for it.
- Default `READ COMMITTED` is fine for `Update`; correctness comes from the row locks below, not from a stricter level.
- A service never keeps a `Repos` after `fn` returns.
- Retry policy: none by design. With one global lock order (below) a deadlock cannot happen between the service's own writes. If PostgreSQL still reports a deadlock (`40P01`) or a serialization failure (`40001`), that is a bug in the lock order: return it as an error (`server_error`), do not retry around it.

## Locks and lock order

Row locks are held until the transaction ends. In PostgreSQL a plain `UPDATE` also takes the row lock, so these statements take locks implicitly, not only the `FOR UPDATE` ones:

| Statement | Locks | Where it happens |
|---|---|---|
| `BoardRepo.Lock(boardID)`: `SELECT id FROM boards WHERE id = $1 FOR UPDATE` | the board row | first statement of every board-visible write |
| `BoardRepo.Touch(boardID, at)`: `UPDATE boards SET updated_at = ...` | the board row | end of every board-visible write (already held) |
| `CardRepo.LockList(listID)`: `SELECT id FROM lists WHERE id = $1 FOR UPDATE` | a list row | card position changes |
| `ListRepo.Save`, `ListRepo.SetPositions` (`UPDATE lists ...`) | list rows | list writes |
| `ChecklistRepo.LockCard(cardID)`: `SELECT id FROM cards WHERE id = $1 FOR UPDATE` | a card row | checklist position changes |
| `CardRepo.Save`, `Touch`, `SetPositions` (`UPDATE cards ...`) | card rows | card writes |

`Lock`, `LockList` and `LockCard` return `ErrNotFound` when the row is absent.

**Lock order (one global order for every transaction): board row first, then list rows, then card rows; within one level, ascending id.** Every service write that changes anything the board shows takes `BoardRepo.Lock` as its first lock, before any `LockList`, `LockCard` or row write. This covers: list create/update/move/archive/restore; card create/update/move/archive/restore, assignees and card labels; checklist writes; comment writes; label create/update/delete; member add/role/remove; project update/archive/restore. A card move between two lists of the same board needs only the one board lock. Without this, `Touch` (a board row lock taken at the end of a write) and `Save` on a list (a list row lock) can be reached in opposite orders by two requests and deadlock; so can a three-way cycle through a card row.

Consequences the owner should accept:

- Board-visible writes are serialised per board. That is intended: one department, short transactions.
- The service re-reads the rows it checks after taking the board lock (`relock`, `loadManaged`), because a read made before the lock may be outdated. This also removes the "Move/Restore build the row from a pre-lock read" problem for the board-visible fields.
- Unlocked reads (the `GET` routes, run in `View`) never block and never wait.
- Never lock a card and then ask for its list or board. A test (`card/lockorder_test.go`) records the calls of 20 write paths and asserts `Boards.Lock` is first; keep it passing when you add a write.

Every position change follows the same sequence (`board.PlaceLocked`): hold the board lock, take the container lock, re-check what could have changed (the list is still live, the card is not archived), read `Positions`, compute, write rebalanced siblings with `SetPositions`, then `Save` the moved row. All inside one `Update`.

## `SetPositions` and the two-step rebalance

The unique indexes are not deferrable and (for lists and cards) partial:

```sql
CREATE UNIQUE INDEX ON lists (board_id, position) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX ON cards (list_id, position)  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX ON checklist_items (card_id, position);  -- no archive, so not partial
```

PostgreSQL checks a non-deferrable unique index per row while one `UPDATE` runs, so a single statement that shifts keys (`a -> b`, `b -> c`) can fail halfway even though the final state is valid. A rebalance therefore takes two statements, in this order, in the same transaction:

1. Park (binding, as written in the `// SQL:` of `SetPositions`): `UPDATE <table> SET position = '~' || id WHERE id = ANY($1) OR (<container> IN (SELECT <container> FROM <table> WHERE id = ANY($1)) AND position = ANY($newPositions) AND id <> ALL($1) [AND archived_at IS NULL])`. `~` sorts after every base-36 digit and the suffix is the id, so a parked key never collides with a real key or with another parked key. `<container>` is `board_id` (lists), `list_id` (cards) or `card_id` (checklist items); the method only receives `[]IDPos`, so the container is looked up from the given rows themselves (`ps` is never empty for a rebalance; with an empty `ps` do nothing). The `archived_at IS NULL` part exists for lists and cards, whose unique index is partial.
2. Write: `UPDATE <table> SET position = v.position FROM (VALUES ...) v WHERE <table>.id = v.id`.

Notes for the owner:

- `SetPositions` writes the rows it is given, archived or not. `Positions` reports archived rows (flagged `Archived`) so keys stay unique, but they are not valid drop neighbours.
- The extra parking clause in step 1 is not optional. The moved row is not in the rebalanced list: the service computes its key against the new sibling keys and writes it afterwards with `Save`. The memory store has no unique index, so a collision between that row's old key and a new sibling key is invisible there; in PostgreSQL it fails the statement. The one row parked outside `ps` is that moving row, and the caller always `Save`s it with its final position in the same transaction, so nothing is left parked.
- A write that violates a unique index is a bug in the caller, not a user error: return it as an error (`server_error`).

## ETag: when `boards.updated_at` must change

`GET /projects/{projectID}/board` builds its weak ETag from `boards.updated_at` and the caller's role. Any change the board screen shows must call `BoardRepo.Touch(boardID, now)` in the same transaction as the change. A write that forgets it leaves clients with a stale 304.

Services call `Touch` for these writes (the repo does not do it implicitly):

| Area | Writes that touch the board |
|---|---|
| Lists | create, rename / `isDone`, move, archive, restore |
| Cards | create, update (title, priority, dates, description), move, archive, restore |
| Assignees | assign, unassign (only when a row was added or removed) |
| Card labels | add, remove (only when a row was added or removed) |
| Checklist | add, update, move, delete |
| Comments | add, edit, delete (the board shows the comment count) |
| Labels | create, update, delete |
| Members | add, change role, remove |
| Project | update (name, description, status, dates), archive, restore |

Writes that also touch the card (`CardRepo.Touch(cardID, now)`, `cards.updated_at`): checklist add/update/move/delete, comment add/edit/delete, assign/unassign and label add/remove when a row changed, and label delete for every card that lost the label (the ids come from `LabelRepo.Delete`).

Project writes (`Update`, `Archive`, `Restore`) touch the board too, because the board payload includes the project name, status, dates and `archivedAt`. A test in `board/handlers_test.go` pins it.

## `completed_at`

`cards.completed_at` is set and cleared by the services; the store only stores it.

- A card created in a done list (`lists.is_done`) is created with `completed_at = now`.
- Moving a card from a not-done list into a done list sets `completed_at = now` if it was null. Moving it out of a done list sets it to null. A move within the same list, or between two done lists, keeps it.
- Setting `lists.is_done = true` calls `CardRepo.SetCompletedForList(listID, &now)`: only active cards (`archived_at IS NULL`) that have no `completed_at` get it, so an existing completion time is never overwritten. Setting it to false calls it with `nil`, which clears every active card of the list.
- The `isDone` flag is re-applied on every request that carries it, so cards added since the flag was set are caught up.
- Archived cards are left alone by `SetCompletedForList`.

## Board snapshot: no N+1

`BoardRepo.Snapshot(projectID)` is what `GET /projects/{projectID}/board` reads. It must run inside one `View` with a constant number of queries, regardless of the number of lists, cards or assignees (the load-test seed has 2,000 cards; the board must load in one round trip of a handful of queries, never one query per card or per list).

A workable plan (the `// SQL:` line on the method is the binding version):

1. `boards` by `project_id`; the project row.
2. `lists WHERE board_id = $1 AND archived_at IS NULL ORDER BY position COLLATE "C"`.
3. `cards JOIN lists ON lists.id = cards.list_id WHERE lists.board_id = $1 AND lists.archived_at IS NULL AND cards.archived_at IS NULL`, with `checklist_total`, `checklist_done` and `comment_count` from grouped subqueries (or `LEFT JOIN ... GROUP BY`), counting only `deleted_at IS NULL` comments. Order by `position COLLATE "C", id`.
4. `card_assignees` and `card_labels` with `card_id = ANY($ids)`, folded into `AssigneeIDs` / `LabelIDs` ascending (never nil: empty slices).
5. `labels` of the project, `project_members` of the project, and `user_cache WHERE user_id = ANY(members + assignees)`.

`Users` must hold the cached profile of every member and every assignee, so the client never needs a second request to draw avatars.

## Parked review items the owner must handle

These were found in review and deliberately left for the PostgreSQL work.

1. **Last-PM guard under concurrency.** Handled by the board lock: every member write (add, role change, remove) takes `BoardRepo.Lock` on the project's board first (see Locks), so two concurrent demotions or removals of the same project run one after the other, and the second sees the first one's result. `MemberRepo.CountPM` is therefore the plain `SELECT count(*)` of its `// SQL:` line; it needs no row lock of its own. Keep every member write behind the board lock when wiring PostgreSQL, or this guard breaks.
2. **Name comparison: pick one rule.** `ProjectRepo.NameTaken` and `LabelRepo.NameTaken` use `lower(name)` in SQL; the memory store uses `strings.EqualFold`. They differ for some Unicode characters (for example `İ`, `ß`, final sigma). Choose one rule and make the unique indexes (`lower(name)`) and the memory store agree. Thai has no case, so the common data is unaffected.
3. **User-service calls inside `Update`.** In `project.Service`, `Create`, `AddMember`, `SetRole` and `Me` call user-service (`up.Get`) from inside the `Update` callback. With the memory store that is free; with PostgreSQL it holds a transaction (and, for `SetRole`, member-row locks) open across a network call. When wiring PostgreSQL, move the `up.Get` call before `Update` and pass the result in.
4. **Card `Move` and `Restore` and the pre-lock read.** Fixed in the services: every write re-reads its rows after taking the board lock (see Locks). `Move` and `Restore` still read the destination list before `LockList`; the list is re-checked live under `LockList` (`listLive`). Keep that order in the PostgreSQL wiring.

## Per-method reference

Every method below is copied from the doc comments in `internal/store/repos.go` (the `// SQL:` line is the obligation). If a doc comment changes, regenerate this section; the comment is the source of truth.

### Store

**`View`**

- Does: runs `fn` read-only.
- SQL obligation: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY ... COMMIT`, so one request sees one snapshot across several queries.

**`Update`**

- Does: runs `fn` as one atomic unit: every write `fn` makes, including its activity event, becomes visible together or not at all.
- SQL obligation: `BEGIN ... COMMIT` when `fn` returns nil, `ROLLBACK` when it returns an error.

### ProjectRepo

**`Create`**

```go
Create(ctx context.Context, p Project) (Project, error)
```

- Does: Create assigns ID and stores p as given (the service sets timestamps).
- SQL obligation: INSERT INTO projects ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (Project, error)
```

- Does: Get returns ErrNotFound for a missing project.
- SQL obligation: SELECT ... FROM projects WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, p Project) error
```

- Does: Save overwrites every column of an existing project; ErrNotFound if absent.
- SQL obligation: UPDATE projects SET all columns WHERE id = $1.

**`All`**

```go
All(ctx context.Context) ([]Project, error)
```

- Does: All returns every project, archived included.
- SQL obligation: SELECT ... FROM projects.

**`ByMember`**

```go
ByMember(ctx context.Context, userID int64) ([]Project, error)
```

- Does: ByMember returns the projects userID is a member of, archived included.
- SQL obligation: SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = $1.

**`NameTaken`**

```go
NameTaken(ctx context.Context, name string, exceptID int64) (bool, error)
```

- Does: NameTaken reports whether a non-archived project other than exceptID has this name, ignoring case.
- SQL obligation: SELECT EXISTS (SELECT 1 FROM projects WHERE lower(name) = lower($1) AND archived_at IS NULL AND id <> $2).

**`Summaries`**

```go
Summaries(ctx context.Context, projectIDs []int64) (map[int64]ProjectSummary, error)
```

- Does: Summaries returns the members, the card progress and the count of non-deleted reports of each listed project in one call. A project without members or cards still gets an entry (empty Members, zero counts). Active cards exclude archived cards and cards of archived lists; done means completed_at IS NOT NULL. Backs `GET /projects`.
- SQL obligation: constant number of queries, no N+1, for any number of projects: `SELECT project_id, user_id, role, added_at FROM project_members WHERE project_id = ANY($1)`; and `SELECT b.project_id, count(*) AS total, count(c.completed_at) AS done FROM boards b JOIN lists l ON l.board_id = b.id AND l.archived_at IS NULL JOIN cards c ON c.list_id = l.id AND c.archived_at IS NULL WHERE b.project_id = ANY($1) GROUP BY b.project_id`; and `SELECT project_id, count(*) FROM documents WHERE project_id = ANY($1) AND deleted_at IS NULL GROUP BY project_id`. Owner and member profiles come from one `user_cache WHERE user_id = ANY(...)` read.

### MemberRepo

**`Get`**

```go
Get(ctx context.Context, projectID, userID int64) (Member, error)
```

- Does: Get returns ErrNotFound when userID is not a member.
- SQL obligation: SELECT ... FROM project_members WHERE project_id = $1 AND user_id = $2.

**`List`**

```go
List(ctx context.Context, projectID int64) ([]Member, error)
```

- Does: List returns the project's members ordered by added_at, user_id.
- SQL obligation: SELECT ... FROM project_members WHERE project_id = $1 ORDER BY added_at, user_id.

**`Put`**

```go
Put(ctx context.Context, m Member) error
```

- Does: Put inserts or replaces the (project, user) row.
- SQL obligation: INSERT ... ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role.

**`Delete`**

```go
Delete(ctx context.Context, projectID, userID int64) error
```

- Does: Delete removes the row; ErrNotFound if absent.
- SQL obligation: DELETE FROM project_members WHERE project_id = $1 AND user_id = $2.

**`CountPM`**

```go
CountPM(ctx context.Context, projectID int64) (int, error)
```

- Does: CountPM counts members with role pm. System admins who are not members are not counted.
- SQL obligation: SELECT count(*) FROM project_members WHERE project_id = $1 AND role = 'pm'.

### BoardRepo

**`Create`**

```go
Create(ctx context.Context, b Board) (Board, error)
```

- Does: Create assigns ID and stores b.
- SQL obligation: INSERT INTO boards ... RETURNING id.

**`ByProject`**

```go
ByProject(ctx context.Context, projectID int64) (Board, error)
```

- Does: ByProject returns the project's single board; ErrNotFound if none.
- SQL obligation: SELECT ... FROM boards WHERE project_id = $1.

**`Get`**

```go
Get(ctx context.Context, id int64) (Board, error)
```

- Does: Get returns ErrNotFound for a missing board.
- SQL obligation: SELECT ... FROM boards WHERE id = $1.

**`Snapshot`**

```go
Snapshot(ctx context.Context, projectID int64) (BoardSnapshot, error)
```

- Does: Snapshot returns everything the board screen shows, from one read snapshot. Lists and cards exclude archived rows (cards of an archived list too) and are ordered by position, then id. Users holds the cached profiles of the members and of every assignee. CardSummary counts exclude soft-deleted comments. ErrNotFound if the project has no board.
- SQL obligation: one View, constant number of queries and no N+1: boards by project_id; lists WHERE board_id AND archived_at IS NULL; cards JOIN lists WHERE archived_at IS NULL on both, with checklist and comment counts via grouped subqueries (idx_cards_list, idx_checklist_card, idx_comments_card); the checklist preview (first 3 items per card, ORDER BY position COLLATE "C", id) in one query, `SELECT ... FROM (SELECT ci.*, row_number() OVER (PARTITION BY card_id ORDER BY position COLLATE "C", id) rn FROM checklist_items ci WHERE card_id = ANY(...)) t WHERE rn <= 3`, never per card; card_assignees and card_labels with card_id = ANY(...); labels, members and user_cache WHERE user_id = ANY(...). All ORDER BY position COLLATE "C".

**`Lock`**

```go
Lock(ctx context.Context, boardID int64) error
```

- Does: Lock takes the board's row lock for the rest of the transaction. It is the first lock of every write that changes anything the board shows (lock order: board, then list, then card; see docs/db-contract.md). It serialises writes per board, so concurrent writers cannot deadlock on the board row that Touch and the list/card writes also reach. ErrNotFound if the board is absent.
- SQL obligation: SELECT id FROM boards WHERE id = $1 FOR UPDATE.

**`Touch`**

```go
Touch(ctx context.Context, boardID int64, at time.Time) error
```

- Does: Touch sets boards.updated_at, which is the board's ETag source.
- SQL obligation: UPDATE boards SET updated_at = $2 WHERE id = $1.

### ListRepo

**`Create`**

```go
Create(ctx context.Context, l List) (List, error)
```

- Does: Create assigns ID and stores l.
- SQL obligation: INSERT INTO lists ... RETURNING id.

**`ByBoard`**

```go
ByBoard(ctx context.Context, boardID int64) ([]List, error)
```

- Does: ByBoard returns every list of the board, archived included, ordered by position.
- SQL obligation: SELECT ... FROM lists WHERE board_id = $1 ORDER BY position COLLATE "C".

**`Get`**

```go
Get(ctx context.Context, id int64) (List, error)
```

- Does: Get returns ErrNotFound for a missing list.
- SQL obligation: SELECT ... FROM lists WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, l List) error
```

- Does: Save overwrites every column of an existing list; ErrNotFound if absent.
- SQL obligation: UPDATE lists SET all columns WHERE id = $1.

**`Positions`**

```go
Positions(ctx context.Context, boardID int64) ([]IDPos, error)
```

- Does: Positions returns every list of the board, archived included, ordered by position. Archived rows are flagged.
- SQL obligation: SELECT id, position, archived_at IS NOT NULL FROM lists WHERE board_id = $1 ORDER BY position COLLATE "C".

**`SetPositions`**

```go
SetPositions(ctx context.Context, ps []IDPos) error
```

- Does: SetPositions rewrites the position of each listed list. The unique index (board_id, position) is not deferrable, so a plain UPDATE can collide mid-statement.
- SQL obligation: step 1 (park) UPDATE lists SET position = '~' || id WHERE id = ANY($1) OR (board_id IN (SELECT board_id FROM lists WHERE id = ANY($1)) AND position = ANY($newPositions) AND id <> ALL($1) AND archived_at IS NULL); the container is found from the rows themselves, and the one parked row outside ps is the moving row, which the caller Saves with its new position in the same transaction; step 2 UPDATE lists SET position = v.position FROM (VALUES ...) v WHERE lists.id = v.id.

**`Archived`**

```go
Archived(ctx context.Context, boardID int64) ([]List, []CardSummary, error)
```

- Does: Archived returns the board's archived lists (ordered by position) and its archived cards (ordered by position, then id).
- SQL obligation: SELECT ... FROM lists WHERE board_id = $1 AND archived_at IS NOT NULL; cards JOIN lists ON list_id WHERE lists.board_id = $1 AND cards.archived_at IS NOT NULL.

### CardRepo

**`Create`**

```go
Create(ctx context.Context, c Card) (Card, error)
```

- Does: Create assigns ID and stores c as given.
- SQL obligation: INSERT INTO cards ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (Card, error)
```

- Does: Get returns ErrNotFound for a missing card.
- SQL obligation: SELECT ... FROM cards WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, c Card) error
```

- Does: Save overwrites every column of an existing card; ErrNotFound if absent.
- SQL obligation: UPDATE cards SET all columns WHERE id = $1.

**`SetCompletedForList`**

```go
SetCompletedForList(ctx context.Context, listID int64, at *time.Time) error
```

- Does: SetCompletedForList sets completed_at on the list's active cards. A non-nil at is written only to cards that have none; nil clears it on every active card.
- SQL obligation: UPDATE cards SET completed_at = $2 WHERE list_id = $1 AND archived_at IS NULL AND completed_at IS NULL (non-nil at) | AND completed_at IS NOT NULL (nil at).

**`Touch`**

```go
Touch(ctx context.Context, cardID int64, at time.Time) error
```

- Does: Touch sets cards.updated_at; used when only a child row changed.
- SQL obligation: UPDATE cards SET updated_at = $2 WHERE id = $1.

**`LockList`**

```go
LockList(ctx context.Context, listID int64) error
```

- Does: LockList serialises position changes in one list for the rest of the transaction. ErrNotFound if the list is absent.
- SQL obligation: SELECT id FROM lists WHERE id = $1 FOR UPDATE.

**`Positions`**

```go
Positions(ctx context.Context, listID int64) ([]IDPos, error)
```

- Does: Positions returns every card of the list, archived included and flagged, ordered by position then id.
- SQL obligation: SELECT id, position, archived_at IS NOT NULL FROM cards WHERE list_id = $1 ORDER BY position COLLATE "C", id.

**`SetPositions`**

```go
SetPositions(ctx context.Context, ps []IDPos) error
```

- Does: SetPositions rewrites the position of each listed card. The unique index (list_id, position) is not deferrable, so use the two-step update.
- SQL obligation: step 1 (park) UPDATE cards SET position = '~' || id WHERE id = ANY($1) OR (list_id IN (SELECT list_id FROM cards WHERE id = ANY($1)) AND position = ANY($newPositions) AND id <> ALL($1) AND archived_at IS NULL); the container is found from the rows themselves, and the one parked row outside ps is the moving row, which the caller Saves with its new position in the same transaction; step 2 UPDATE cards SET position = v.position FROM (VALUES ...) v WHERE cards.id = v.id.

**`AddAssignee`**

```go
AddAssignee(ctx context.Context, cardID, userID int64, at time.Time) (bool, error)
```

- Does: AddAssignee reports whether a row was added; an existing one is left alone (false).
- SQL obligation: INSERT INTO card_assignees (card_id, user_id, assigned_at) VALUES (...) ON CONFLICT DO NOTHING; added = rows affected is 1.

**`RemoveAssignee`**

```go
RemoveAssignee(ctx context.Context, cardID, userID int64) (bool, error)
```

- Does: RemoveAssignee reports whether a row was removed.
- SQL obligation: DELETE FROM card_assignees WHERE card_id = $1 AND user_id = $2; removed = rows affected is 1.

**`AddLabel`**

```go
AddLabel(ctx context.Context, cardID, labelID int64) (bool, error)
```

- Does: AddLabel reports whether a row was added; an existing one is left alone (false). ErrNotFound if the card is absent.
- SQL obligation: INSERT INTO card_labels (card_id, label_id) VALUES (...) ON CONFLICT DO NOTHING; added = rows affected is 1.

**`RemoveLabel`**

```go
RemoveLabel(ctx context.Context, cardID, labelID int64) (bool, error)
```

- Does: RemoveLabel reports whether a row was removed.
- SQL obligation: DELETE FROM card_labels WHERE card_id = $1 AND label_id = $2; removed = rows affected is 1.

**`Children`**

```go
Children(ctx context.Context, cardID int64) (CardChildren, error)
```

- Does: Children returns what the card detail shows besides the card row: assignee ids and label ids ascending, checklist items by position. Return empty slices, never nil, for a card without rows (the service also guards, but the contract is "never nil").
- SQL obligation: three queries by card_id (card_assignees, card_labels, checklist_items ORDER BY position COLLATE "C").

### LabelRepo

**`Create`**

```go
Create(ctx context.Context, l Label) (Label, error)
```

- Does: Create assigns ID and stores l.
- SQL obligation: INSERT INTO labels ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (Label, error)
```

- Does: Get returns ErrNotFound for a missing label.
- SQL obligation: SELECT ... FROM labels WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, l Label) error
```

- Does: Save overwrites name and color of an existing label; ErrNotFound if absent.
- SQL obligation: UPDATE labels SET name = $2, color = $3 WHERE id = $1.

**`ByProject`**

```go
ByProject(ctx context.Context, projectID int64) ([]Label, error)
```

- Does: ByProject returns the project's labels ordered by id.
- SQL obligation: SELECT ... FROM labels WHERE project_id = $1 ORDER BY id.

**`NameTaken`**

```go
NameTaken(ctx context.Context, projectID int64, name string, exceptID int64) (bool, error)
```

- Does: NameTaken reports whether another label of the project has this name, ignoring case.
- SQL obligation: SELECT EXISTS (SELECT 1 FROM labels WHERE project_id = $1 AND lower(name) = lower($2) AND id <> $3).

**`Delete`**

```go
Delete(ctx context.Context, id int64) ([]int64, error)
```

- Does: Delete removes the label and its card_labels rows and returns the ids of the cards that lost it, ascending. ErrNotFound if absent.
- SQL obligation: DELETE FROM card_labels WHERE label_id = $1 RETURNING card_id; DELETE FROM labels WHERE id = $1.

### ChecklistRepo

**`LockCard`**

```go
LockCard(ctx context.Context, cardID int64) error
```

- Does: LockCard serialises checklist position changes on one card for the rest of the transaction. ErrNotFound if the card is absent.
- SQL obligation: SELECT id FROM cards WHERE id = $1 FOR UPDATE.

**`Create`**

```go
Create(ctx context.Context, it ChecklistItem) (ChecklistItem, error)
```

- Does: Create assigns ID and stores it as given.
- SQL obligation: INSERT INTO checklist_items ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (ChecklistItem, error)
```

- Does: Get returns ErrNotFound for a missing item.
- SQL obligation: SELECT ... FROM checklist_items WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, it ChecklistItem) error
```

- Does: Save overwrites an existing item; ErrNotFound if absent.
- SQL obligation: UPDATE checklist_items SET all columns WHERE id = $1.

**`Delete`**

```go
Delete(ctx context.Context, id int64) error
```

- Does: Delete removes the item (hard delete); ErrNotFound if absent.
- SQL obligation: DELETE FROM checklist_items WHERE id = $1.

**`Positions`**

```go
Positions(ctx context.Context, cardID int64) ([]IDPos, error)
```

- Does: Positions returns the card's items ordered by position then id. Archived is always false: items have no archive.
- SQL obligation: SELECT id, position, false FROM checklist_items WHERE card_id = $1 ORDER BY position COLLATE "C", id.

**`SetPositions`**

```go
SetPositions(ctx context.Context, ps []IDPos) error
```

- Does: SetPositions rewrites the position of each listed item. The unique index (card_id, position) is not deferrable, so use the two-step update.
- SQL obligation: step 1 (park) UPDATE checklist_items SET position = '~' || id WHERE id = ANY($1) OR (card_id IN (SELECT card_id FROM checklist_items WHERE id = ANY($1)) AND position = ANY($newPositions) AND id <> ALL($1)); the container is found from the rows themselves, and the one parked row outside ps is the moving row, which the caller Saves with its new position in the same transaction; step 2 UPDATE checklist_items SET position = v.position FROM (VALUES ...) v WHERE checklist_items.id = v.id.

### CommentRepo

**`Create`**

```go
Create(ctx context.Context, c Comment) (Comment, error)
```

- Does: Create assigns ID and stores c as given.
- SQL obligation: INSERT INTO comments ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (Comment, error)
```

- Does: Get returns a comment even when soft-deleted (the caller checks DeletedAt); ErrNotFound if absent.
- SQL obligation: SELECT ... FROM comments WHERE id = $1.

**`Save`**

```go
Save(ctx context.Context, c Comment) error
```

- Does: Save overwrites body, edited_at and deleted_at of an existing comment; ErrNotFound if absent.
- SQL obligation: UPDATE comments SET body_md = $2, edited_at = $3, deleted_at = $4 WHERE id = $1.

**`ByCard`**

```go
ByCard(ctx context.Context, cardID int64) ([]Comment, error)
```

- Does: ByCard returns the card's non-deleted comments, oldest first.
- SQL obligation: SELECT ... FROM comments WHERE card_id = $1 AND deleted_at IS NULL ORDER BY created_at, id.

**`Mentions`**

```go
Mentions(ctx context.Context, commentID int64) ([]int64, error)
```

- Does: Mentions returns the mentioned user ids of one comment, ascending.
- SQL obligation: SELECT user_id FROM comment_mentions WHERE comment_id = $1 ORDER BY user_id.

**`MentionsByCard`**

```go
MentionsByCard(ctx context.Context, cardID int64) (map[int64][]int64, error)
```

- Does: MentionsByCard returns mentioned user ids (ascending) per comment id for the card's non-deleted comments; comments without mentions are absent.
- SQL obligation: SELECT m.comment_id, m.user_id FROM comment_mentions m JOIN comments c ON c.id = m.comment_id WHERE c.card_id = $1 AND c.deleted_at IS NULL ORDER BY m.user_id.

**`SetMentions`**

```go
SetMentions(ctx context.Context, commentID int64, userIDs []int64) error
```

- Does: SetMentions replaces the comment's mention rows with userIDs.
- SQL obligation: DELETE FROM comment_mentions WHERE comment_id = $1; INSERT INTO comment_mentions (comment_id, user_id) SELECT $1, unnest($2::bigint[]).

### UserRoleRepo

**`Get`**

```go
Get(ctx context.Context, userID int64) (*UserRole, error)
```

- Does: Get returns the caller's system role, or nil when the user has no row (a regular user).
- SQL obligation: SELECT ... FROM user_roles WHERE user_id = $1; no row gives nil, nil.

### UserRepo

**`Upsert`**

```go
Upsert(ctx context.Context, us []CachedUser) error
```

- Does: Upsert inserts or refreshes cached users. A zero SyncedAt means now.
- SQL obligation: INSERT INTO user_cache ... ON CONFLICT (user_id) DO UPDATE SET all columns.

**`Get`**

```go
Get(ctx context.Context, ids []int64) ([]CachedUser, error)
```

- Does: Get returns the cached users that exist, in the order of ids; unknown ids are skipped, not an error.
- SQL obligation: SELECT ... FROM user_cache WHERE user_id = ANY($1), ordered to match ids.

**`Stale`**

```go
Stale(ctx context.Context, before time.Time, limit int) ([]int64, error)
```

- Does: Stale returns up to limit ids whose synced_at is before the cutoff, oldest first.
- SQL obligation: SELECT user_id FROM user_cache WHERE synced_at < $1 ORDER BY synced_at LIMIT $2.

### ActivityRepo

**`Append`**

```go
Append(ctx context.Context, e ActivityEvent) error
```

- Does: Append records one event; the store assigns ID and, when CreatedAt is zero, sets it to now. Must run in the same transaction as the change it describes.
- SQL obligation: INSERT INTO activity_events (project_id, card_id, actor_id, type, payload, created_at) ...; payload is changed ids/values only.


### DocumentRepo

Backs the Reports page (`internal/document`). Table `documents`: `id, project_id, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, deleted_at`, with `idx_documents_project (project_id, created_at DESC)`. Document writes do not touch `boards.updated_at` (the board does not show documents), so there is no board ETag bump and no board lock; the service runs a plain `Update`. Each write records its activity event (`document.uploaded`, `document.deleted`, `document.restored`, `card_id` NULL, payload `{"documentId": id}`) in the same transaction.

**`Create`**

```go
Create(ctx context.Context, d Document) (Document, error)
```

- Does: Create assigns ID and stores d as given.
- SQL obligation: INSERT INTO documents (project_id, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at) ... RETURNING id.

**`Get`**

```go
Get(ctx context.Context, id int64) (Document, error)
```

- Does: Get returns a document even when soft-deleted (the caller checks DeletedAt); ErrNotFound if absent.
- SQL obligation: SELECT ... FROM documents WHERE id = $1.

**`SetDeleted`**

```go
SetDeleted(ctx context.Context, id int64, at *time.Time) error
```

- Does: SetDeleted sets deleted_at (nil restores); ErrNotFound if absent. No other column changes.
- SQL obligation: UPDATE documents SET deleted_at = $2 WHERE id = $1.

**`ByProject`**

```go
ByProject(ctx context.Context, projectID int64) ([]Document, error)
```

- Does: ByProject returns the project's non-deleted documents, newest first.
- SQL obligation: SELECT ... FROM documents WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC (idx_documents_project).

### TemplateRepo

Backs Reports › Templates (`internal/document/templates.go`). Table `report_templates`: `id, category, name, description, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, updated_at, deleted_at`, department-wide (no `project_id`), with `idx_report_templates_live (lower(category), lower(name), id) WHERE deleted_at IS NULL`. Any signed-in user may upload, edit, delete and restore (owner's decision, 2026-11-20); deletes are soft so Undo works, and the blob is kept. There is no `activity_events` row: that table is per project. Blob keys are `templates/<random hex><ext>`.

**`Create`**
- SQL obligation: INSERT INTO report_templates (category, name, description, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, updated_at) ... RETURNING id.

**`Get`**
- Does: returns a template even when soft-deleted (the service hides it); ErrNotFound if absent.
- SQL obligation: SELECT ... FROM report_templates WHERE id = $1.

**`SaveDetails`**
- Does: writes category, name, description and updated_at only; the file columns never change.
- SQL obligation: UPDATE report_templates SET category = $2, name = $3, description = $4, updated_at = $5 WHERE id = $1; ErrNotFound when no row.

**`SetDeleted`**
- SQL obligation: UPDATE report_templates SET deleted_at = $2 WHERE id = $1 (nil restores); ErrNotFound when no row.

**`List`**
- SQL obligation: SELECT ... FROM report_templates WHERE deleted_at IS NULL ORDER BY lower(category), lower(name), id (`idx_report_templates_live`). The memory store compares with `strings.ToLower`; see parked item 2 for the case-folding rule.

### TeamRepo

Backs the Team page (`internal/team`). Table `user_skills (user_id bigint, skill text, position int, PRIMARY KEY (user_id, skill))` with `ux_user_skills (user_id, lower(skill))`. No foreign key: people live in user-service; `user_id` is their id. Any signed-in user may edit anyone's skills (owner's decision, 2026-11-20). No `activity_events` row: that table is per project. The service trims tags, squeezes inner spaces, drops blanks and case-insensitive duplicates (first spelling wins), and caps at 30 tags of 40 characters before calling the repo.

**`Skills`**
- Does: every user's skills in saved order; users with none are absent.
- SQL obligation: SELECT user_id, array_agg(skill ORDER BY position) FROM user_skills GROUP BY user_id.

**`SetSkills`**
- Does: replaces one person's set in one transaction; an empty slice deletes them all.
- SQL obligation: DELETE FROM user_skills WHERE user_id = $1; INSERT INTO user_skills (user_id, skill, position) SELECT $1, s, ord FROM unnest($2::text[]) WITH ORDINALITY AS t(s, ord).

**`Workload`**
- Does: per assignee, open cards across every project (not archived, active list, non-archived project, completed_at IS NULL): total, overdue (due before today), due soon (today up to `soon`, exclusive). Assignees with nothing open are absent. The page shows counts only, never the cards, so a project the caller cannot see is not revealed.
- SQL obligation: one grouped query driven by `card_assignees`; see the comment on `TeamRepo.Workload` in `internal/store/repos.go`.

### Blob store contract (`internal/blob`)

Uploaded files are bytes in a `blob.Store`, never in the database and never in a public folder. The service writes the blob first and the row second inside `Store.Update`; if the row write fails it deletes the blob. Delete is soft: only `deleted_at` is set, the blob stays so restore works.

- `Put(ctx, key, r) (int64, error)`: stores r under key, returns the bytes written, and leaves nothing behind on failure.
- `Open(ctx, key)`: returns the content, or `blob.ErrNotFound`.
- `Delete(ctx, key)`: a missing key is not an error.
- The key is server-generated, `<projectID>/<random>.pdf`, and never derived from the client file name. The original name lives only in `documents.filename`. A key that is empty, absolute, or has a `.`, `..` or empty segment is `blob.ErrInvalidKey`.
- The local implementation writes under `UPLOAD_DIR` (default `./uploads`, git-ignored). A MinIO implementation replaces it later behind the same interface.

### DashboardRepo

Backs the Dashboard page (`internal/dashboard`). Read-only; the service runs it in `View` together with the project scope, `Projects.Summaries` (members) and one `user_cache` read.

**`Rows`**

- Does: Rows returns every active card of the listed projects (card not archived, list not archived, project not archived), one `DashboardRow` per card with project id and name, list name, title, priority, start and due dates, `completed_at` and assignee ids (ascending, never nil). Ordered by project id, then card id. Status classification and all counts are done in Go (`dashboard.Build`), so the SQL carries no status logic.
- SQL obligation: one query, no N+1 for any number of projects: `SELECT c.id, p.id, p.name, l.name, c.title, c.priority, c.start_date, c.due_date, c.completed_at, COALESCE(array_agg(a.user_id ORDER BY a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') FROM cards c JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL JOIN boards b ON b.id = l.board_id JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL LEFT JOIN card_assignees a ON a.card_id = c.id WHERE p.id = ANY($1) AND c.archived_at IS NULL GROUP BY c.id, p.id, l.id ORDER BY p.id, c.id` (`idx_cards_list`).
- Today: the service computes today as the Asia/Bangkok date from the injected clock (fixed `+07:00` fallback), never in SQL, so memory and PostgreSQL agree.

**`AssignedTo`**

```go
AssignedTo(ctx context.Context, userID int64, projectIDs []int64) ([]TaskRow, error)
```

- Does: backs My Tasks (`GET /me/tasks`). Returns the open cards (`completed_at IS NULL`) of the listed projects that `userID` is assigned to, with the same active rules as `Rows`. Each `TaskRow` is a `DashboardRow` (assignee ids include the other people on the card) plus checklist total and done counts. Ordered by due date with no due date last, then card id.
- SQL obligation: one query, no N+1, driven by the `card_assignees (user_id)` index: `SELECT c.id, p.id, p.name, l.name, c.title, c.priority, c.start_date, c.due_date, c.completed_at, (SELECT array_agg(user_id ORDER BY user_id) FROM card_assignees WHERE card_id = c.id), (SELECT count(*) FROM checklist_items WHERE card_id = c.id), (SELECT count(*) FILTER (WHERE is_done) FROM checklist_items WHERE card_id = c.id) FROM card_assignees me JOIN cards c ON c.id = me.card_id JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL JOIN boards b ON b.id = l.board_id JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL WHERE me.user_id = $1 AND p.id = ANY($2) AND c.archived_at IS NULL AND c.completed_at IS NULL ORDER BY c.due_date NULLS LAST, c.id` (`idx_checklist_card` for the counts).
