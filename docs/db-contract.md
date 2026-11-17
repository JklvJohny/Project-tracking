# DB contract: what the PostgreSQL `internal/store` must do

For the system owner, who writes the PostgreSQL implementation of `backend/internal/store`.
The in-memory store (`internal/store/memory`) is the reference: every service test runs against it,
so the PostgreSQL store must behave the same way for every method below. Schema: `docs/ERD.md`.
API shapes: `backend/api/openapi.yaml`.

Ground rules:

- Services never see SQL. They call the repo interfaces in `internal/store/repos.go` inside `Store.View` or `Store.Update`.
- Every id is `int64` (`bigint`), user ids included. User ids have no foreign key (they come from user-service).
- A missing row is `store.ErrNotFound`, never `sql.ErrNoRows` and never a nil value. Services map it to `not_found`.
- Dates are `DATE` and travel as `store.Date` (`"YYYY-MM-DD"`). Timestamps are `timestamptz`, stored as UTC instants.
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
- Retry policy: none. A serialization or deadlock error is returned as an error and becomes `server_error`. With the lock order below it should not happen.

## Locks and lock order

Three methods take a row lock for the rest of the transaction. They exist so two concurrent moves in one container cannot compute the same position.

| Method | SQL | Guards |
|---|---|---|
| `ListRepo.LockBoard(boardID)` | `SELECT id FROM boards WHERE id = $1 FOR UPDATE` | list positions on the board |
| `CardRepo.LockList(listID)` | `SELECT id FROM lists WHERE id = $1 FOR UPDATE` | card positions in the list |
| `ChecklistRepo.LockCard(cardID)` | `SELECT id FROM cards WHERE id = $1 FOR UPDATE` | checklist positions on the card |

All three return `ErrNotFound` when the row is absent.

**Lock order: board, then list, then card; within one level, ascending id.** Today no service call holds two of these locks at once, and the order keeps it that way: any future code that needs more than one must take them in this order. Never lock a card and then ask for its list.

Every position change follows the same sequence (`board.PlaceLocked`): take the lock, re-check what could have changed (the list is still live, the card is not archived), read `Positions`, compute, write rebalanced siblings with `SetPositions`, then `Save` the moved row. All inside one `Update`.

## `SetPositions` and the two-step rebalance

The unique indexes are not deferrable and (for lists and cards) partial:

```sql
CREATE UNIQUE INDEX ON lists (board_id, position) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX ON cards (list_id, position)  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX ON checklist_items (card_id, position);  -- no archive, so not partial
```

PostgreSQL checks a non-deferrable unique index per row while one `UPDATE` runs, so a single statement that shifts keys (`a -> b`, `b -> c`) can fail halfway even though the final state is valid. A rebalance therefore takes two statements, in this order, in the same transaction:

1. Park: `UPDATE <table> SET position = '~' || id WHERE id = ANY($1)`. `~` sorts after every base-36 digit and the suffix is the id, so a parked key never collides with a real key or with another parked key.
2. Write: `UPDATE <table> SET position = v.position FROM (VALUES ...) v WHERE <table>.id = v.id`.

Notes for the owner:

- `SetPositions` writes the rows it is given, archived or not. `Positions` reports archived rows (flagged `Archived`) so keys stay unique, but they are not valid drop neighbours.
- The moved row is not in the rebalanced list. The service computes its key against the new sibling keys and writes it afterwards with `Save`. In the memory store there is no unique index, so a collision between that row's old key and a new sibling key is invisible. In PostgreSQL it is not: when the moved row stays in the same container, step 1 should also park any row of that container whose current `position` equals one of the new values (`... OR (container = $x AND position = ANY($new) AND id <> ALL($ids))`). The moved row is always `Save`d afterwards, so parking it is safe.
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

Writes that also touch the card (`CardRepo.Touch(cardID, now)`, `cards.updated_at`): checklist add/update/move/delete, comment add/edit/delete, assign/unassign and label add/remove when a row changed, and label delete for every card that lost the label (the ids come from `LabelRepo.Delete`).

Known gap, not a contract change: `project.Service.Update`, `Archive` and `Restore` do not touch the board, although the board payload includes the project's name, status and `archivedAt`. A rename can therefore answer 304 until the next board change. Fixing it is a service change (one `Touch` call), not a store change.

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

1. **Last-PM guard under concurrency.** `MemberRepo.CountPM` must lock the project's member rows (`SELECT ... FROM project_members WHERE project_id = $1 FOR UPDATE`, then count) so two concurrent demotions or removals cannot both see two PMs and leave none. `SELECT count(*)` alone is not safe at `READ COMMITTED`. Sort the locked rows by `user_id` to keep the lock order stable.
2. **Name comparison: pick one rule.** `ProjectRepo.NameTaken` and `LabelRepo.NameTaken` use `lower(name)` in SQL; the memory store uses `strings.EqualFold`. They differ for some Unicode characters (for example `İ`, `ß`, final sigma). Choose one rule and make the unique indexes (`lower(name)`) and the memory store agree. Thai has no case, so the common data is unaffected.
3. **User-service calls inside `Update`.** In `project.Service`, `Create`, `AddMember`, `SetRole` and `Me` call user-service (`up.Get`) from inside the `Update` callback. With the memory store that is free; with PostgreSQL it holds a transaction (and, for `SetRole`, member-row locks) open across a network call. When wiring PostgreSQL, move the `up.Get` call before `Update` and pass the result in.
4. **Card `Move` and `Restore` use a pre-lock read.** Both build the row they `Save` from a card read before the list lock. After `LockList`, re-read the card (and its list) and apply the change to that fresh row before `Save`, or a concurrent edit between the read and the lock is overwritten. The memory store cannot show this because `Update` is serialised.

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
- SQL obligation: one View, constant number of queries and no N+1: boards by project_id; lists WHERE board_id AND archived_at IS NULL; cards JOIN lists WHERE archived_at IS NULL on both, with checklist and comment counts via grouped subqueries (idx_cards_list, idx_checklist_card, idx_comments_card); card_assignees and card_labels with card_id = ANY(...); labels, members and user_cache WHERE user_id = ANY(...). All ORDER BY position COLLATE "C".

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

**`LockBoard`**

```go
LockBoard(ctx context.Context, boardID int64) error
```

- Does: LockBoard serialises position changes on one board for the rest of the transaction. ErrNotFound if the board is absent.
- SQL obligation: SELECT id FROM boards WHERE id = $1 FOR UPDATE.

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
- SQL obligation: step 1 UPDATE lists SET position = '~' || id WHERE id = ANY($1); step 2 UPDATE lists SET position = v.position FROM (VALUES ...) v WHERE lists.id = v.id.

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
- SQL obligation: step 1 UPDATE cards SET position = '~' || id WHERE id = ANY($1); step 2 UPDATE cards SET position = v.position FROM (VALUES ...) v WHERE cards.id = v.id.

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

- Does: Children returns what the card detail shows besides the card row: assignee ids and label ids ascending, checklist items by position.
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
- SQL obligation: step 1 UPDATE checklist_items SET position = '~' || id WHERE id = ANY($1); step 2 UPDATE checklist_items SET position = v.position FROM (VALUES ...) v WHERE checklist_items.id = v.id.

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

