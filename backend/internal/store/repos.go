package store

import (
	"context"
	"time"
)

// Repos is the set of repositories bound to one View/Update unit of work.
// Later modules add methods to the empty interfaces; each method's doc
// comment ends with a "// SQL:" line stating what the PostgreSQL
// implementation must do.
type Repos struct {
	Projects  ProjectRepo
	Members   MemberRepo
	Boards    BoardRepo
	Lists     ListRepo
	Cards     CardRepo
	Labels    LabelRepo
	Checklist ChecklistRepo
	Comments  CommentRepo
	UserRoles UserRoleRepo
	Users     UserRepo
	Activity  ActivityRepo
}

type CommentRepo interface {
	// Create assigns ID and stores c as given.
	// SQL: INSERT INTO comments ... RETURNING id.
	Create(ctx context.Context, c Comment) (Comment, error)

	// Get returns a comment even when soft-deleted (the caller checks
	// DeletedAt); ErrNotFound if absent.
	// SQL: SELECT ... FROM comments WHERE id = $1.
	Get(ctx context.Context, id int64) (Comment, error)

	// Save overwrites body, edited_at and deleted_at of an existing comment;
	// ErrNotFound if absent.
	// SQL: UPDATE comments SET body_md = $2, edited_at = $3, deleted_at = $4 WHERE id = $1.
	Save(ctx context.Context, c Comment) error

	// ByCard returns the card's non-deleted comments, oldest first.
	// SQL: SELECT ... FROM comments WHERE card_id = $1 AND deleted_at IS NULL
	// ORDER BY created_at, id.
	ByCard(ctx context.Context, cardID int64) ([]Comment, error)

	// Mentions returns the mentioned user ids of one comment, ascending.
	// SQL: SELECT user_id FROM comment_mentions WHERE comment_id = $1 ORDER BY user_id.
	Mentions(ctx context.Context, commentID int64) ([]int64, error)

	// MentionsByCard returns mentioned user ids (ascending) per comment id for
	// the card's non-deleted comments; comments without mentions are absent.
	// SQL: SELECT m.comment_id, m.user_id FROM comment_mentions m JOIN comments c
	// ON c.id = m.comment_id WHERE c.card_id = $1 AND c.deleted_at IS NULL ORDER BY m.user_id.
	MentionsByCard(ctx context.Context, cardID int64) (map[int64][]int64, error)

	// SetMentions replaces the comment's mention rows with userIDs.
	// SQL: DELETE FROM comment_mentions WHERE comment_id = $1;
	// INSERT INTO comment_mentions (comment_id, user_id) SELECT $1, unnest($2::bigint[]).
	SetMentions(ctx context.Context, commentID int64, userIDs []int64) error
}

type ChecklistRepo interface {
	// LockCard serialises checklist position changes on one card for the rest
	// of the transaction. ErrNotFound if the card is absent.
	// SQL: SELECT id FROM cards WHERE id = $1 FOR UPDATE.
	LockCard(ctx context.Context, cardID int64) error

	// Create assigns ID and stores it as given.
	// SQL: INSERT INTO checklist_items ... RETURNING id.
	Create(ctx context.Context, it ChecklistItem) (ChecklistItem, error)

	// Get returns ErrNotFound for a missing item.
	// SQL: SELECT ... FROM checklist_items WHERE id = $1.
	Get(ctx context.Context, id int64) (ChecklistItem, error)

	// Save overwrites an existing item; ErrNotFound if absent.
	// SQL: UPDATE checklist_items SET all columns WHERE id = $1.
	Save(ctx context.Context, it ChecklistItem) error

	// Delete removes the item (hard delete); ErrNotFound if absent.
	// SQL: DELETE FROM checklist_items WHERE id = $1.
	Delete(ctx context.Context, id int64) error

	// Positions returns the card's items ordered by position then id.
	// Archived is always false: items have no archive.
	// SQL: SELECT id, position, false FROM checklist_items WHERE card_id = $1
	// ORDER BY position COLLATE "C", id.
	Positions(ctx context.Context, cardID int64) ([]IDPos, error)

	// SetPositions rewrites the position of each listed item. The unique index
	// (card_id, position) is not deferrable, so use the two-step update.
	// SQL: step 1 (park) UPDATE checklist_items SET position = '~' || id WHERE id = ANY($1)
	// OR (card_id IN (SELECT card_id FROM checklist_items WHERE id = ANY($1)) AND position = ANY($newPositions)
	// AND id <> ALL($1)); the container is found from the rows themselves, and the
	// one parked row outside ps is the moving row, which the caller Saves with its
	// new position in the same transaction;
	// step 2 UPDATE checklist_items SET position = v.position FROM (VALUES ...) v WHERE checklist_items.id = v.id.
	SetPositions(ctx context.Context, ps []IDPos) error
}

type LabelRepo interface {
	// Create assigns ID and stores l.
	// SQL: INSERT INTO labels ... RETURNING id.
	Create(ctx context.Context, l Label) (Label, error)

	// Get returns ErrNotFound for a missing label.
	// SQL: SELECT ... FROM labels WHERE id = $1.
	Get(ctx context.Context, id int64) (Label, error)

	// Save overwrites name and color of an existing label; ErrNotFound if absent.
	// SQL: UPDATE labels SET name = $2, color = $3 WHERE id = $1.
	Save(ctx context.Context, l Label) error

	// ByProject returns the project's labels ordered by id.
	// SQL: SELECT ... FROM labels WHERE project_id = $1 ORDER BY id.
	ByProject(ctx context.Context, projectID int64) ([]Label, error)

	// NameTaken reports whether another label of the project has this name,
	// ignoring case.
	// SQL: SELECT EXISTS (SELECT 1 FROM labels WHERE project_id = $1
	// AND lower(name) = lower($2) AND id <> $3).
	NameTaken(ctx context.Context, projectID int64, name string, exceptID int64) (bool, error)

	// Delete removes the label and its card_labels rows and returns the ids
	// of the cards that lost it, ascending. ErrNotFound if absent.
	// SQL: DELETE FROM card_labels WHERE label_id = $1 RETURNING card_id;
	// DELETE FROM labels WHERE id = $1.
	Delete(ctx context.Context, id int64) ([]int64, error)
}

type UserRoleRepo interface {
	// Get returns the caller's system role, or nil when the user has no row
	// (a regular user).
	// SQL: SELECT ... FROM user_roles WHERE user_id = $1; no row gives nil, nil.
	Get(ctx context.Context, userID int64) (*UserRole, error)
}

type UserRepo interface {
	// Upsert inserts or refreshes cached users. A zero SyncedAt means now.
	// SQL: INSERT INTO user_cache ... ON CONFLICT (user_id) DO UPDATE SET all columns.
	Upsert(ctx context.Context, us []CachedUser) error

	// Get returns the cached users that exist, in the order of ids; unknown
	// ids are skipped, not an error.
	// SQL: SELECT ... FROM user_cache WHERE user_id = ANY($1), ordered to match ids.
	Get(ctx context.Context, ids []int64) ([]CachedUser, error)

	// Stale returns up to limit ids whose synced_at is before the cutoff,
	// oldest first.
	// SQL: SELECT user_id FROM user_cache WHERE synced_at < $1 ORDER BY synced_at LIMIT $2.
	Stale(ctx context.Context, before time.Time, limit int) ([]int64, error)
}

type ActivityRepo interface {
	// Append records one event; the store assigns ID and, when CreatedAt is
	// zero, sets it to now. Must run in the same transaction as the change it
	// describes.
	// SQL: INSERT INTO activity_events (project_id, card_id, actor_id, type, payload, created_at) ...;
	// payload is changed ids/values only.
	Append(ctx context.Context, e ActivityEvent) error
}

type ProjectRepo interface {
	// Create assigns ID and stores p as given (the service sets timestamps).
	// SQL: INSERT INTO projects ... RETURNING id.
	Create(ctx context.Context, p Project) (Project, error)

	// Get returns ErrNotFound for a missing project.
	// SQL: SELECT ... FROM projects WHERE id = $1.
	Get(ctx context.Context, id int64) (Project, error)

	// Save overwrites every column of an existing project; ErrNotFound if absent.
	// SQL: UPDATE projects SET all columns WHERE id = $1.
	Save(ctx context.Context, p Project) error

	// All returns every project, archived included.
	// SQL: SELECT ... FROM projects.
	All(ctx context.Context) ([]Project, error)

	// ByMember returns the projects userID is a member of, archived included.
	// SQL: SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = $1.
	ByMember(ctx context.Context, userID int64) ([]Project, error)

	// NameTaken reports whether a non-archived project other than exceptID
	// has this name, ignoring case.
	// SQL: SELECT EXISTS (SELECT 1 FROM projects WHERE lower(name) = lower($1)
	// AND archived_at IS NULL AND id <> $2).
	NameTaken(ctx context.Context, name string, exceptID int64) (bool, error)

	// Summaries returns members and card progress for each listed project in
	// one call; a project without members or cards still gets an entry (empty
	// Members, zero counts). Active cards exclude archived cards and cards of
	// archived lists; done means completed_at IS NOT NULL.
	// SQL: no N+1, a constant number of queries for any len(projectIDs):
	// SELECT project_id, user_id, role, added_at FROM project_members WHERE project_id = ANY($1);
	// SELECT b.project_id, count(*) AS total, count(c.completed_at) AS done
	// FROM boards b JOIN lists l ON l.board_id = b.id AND l.archived_at IS NULL
	// JOIN cards c ON c.list_id = l.id AND c.archived_at IS NULL
	// WHERE b.project_id = ANY($1) GROUP BY b.project_id (idx_cards_list).
	Summaries(ctx context.Context, projectIDs []int64) (map[int64]ProjectSummary, error)
}

type MemberRepo interface {
	// Get returns ErrNotFound when userID is not a member.
	// SQL: SELECT ... FROM project_members WHERE project_id = $1 AND user_id = $2.
	Get(ctx context.Context, projectID, userID int64) (Member, error)

	// List returns the project's members ordered by added_at, user_id.
	// SQL: SELECT ... FROM project_members WHERE project_id = $1 ORDER BY added_at, user_id.
	List(ctx context.Context, projectID int64) ([]Member, error)

	// Put inserts or replaces the (project, user) row.
	// SQL: INSERT ... ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role.
	Put(ctx context.Context, m Member) error

	// Delete removes the row; ErrNotFound if absent.
	// SQL: DELETE FROM project_members WHERE project_id = $1 AND user_id = $2.
	Delete(ctx context.Context, projectID, userID int64) error

	// CountPM counts members with role pm. System admins who are not members
	// are not counted.
	// SQL: SELECT count(*) FROM project_members WHERE project_id = $1 AND role = 'pm'.
	CountPM(ctx context.Context, projectID int64) (int, error)
}

type BoardRepo interface {
	// Create assigns ID and stores b.
	// SQL: INSERT INTO boards ... RETURNING id.
	Create(ctx context.Context, b Board) (Board, error)

	// ByProject returns the project's single board; ErrNotFound if none.
	// SQL: SELECT ... FROM boards WHERE project_id = $1.
	ByProject(ctx context.Context, projectID int64) (Board, error)

	// Get returns ErrNotFound for a missing board.
	// SQL: SELECT ... FROM boards WHERE id = $1.
	Get(ctx context.Context, id int64) (Board, error)

	// Snapshot returns everything the board screen shows, from one read
	// snapshot. Lists and cards exclude archived rows (cards of an archived
	// list too) and are ordered by position, then id. Users holds the cached
	// profiles of the members and of every assignee. CardSummary counts
	// exclude soft-deleted comments. Each card carries ChecklistPreview, its
	// first 3 checklist items by position then id. ErrNotFound if the project
	// has no board.
	// SQL: one View, constant number of queries and no N+1: boards by
	// project_id; lists WHERE board_id AND archived_at IS NULL; cards JOIN lists
	// WHERE archived_at IS NULL on both, with checklist and comment counts via
	// grouped subqueries (idx_cards_list, idx_checklist_card, idx_comments_card);
	// the preview in one query, row_number() OVER (PARTITION BY card_id ORDER BY
	// position COLLATE "C", id) <= 3 over checklist_items WHERE card_id = ANY(...);
	// card_assignees and card_labels with card_id = ANY(...); labels, members
	// and user_cache WHERE user_id = ANY(...). All ORDER BY position COLLATE "C".
	Snapshot(ctx context.Context, projectID int64) (BoardSnapshot, error)

	// Lock takes the board's row lock for the rest of the transaction. It is
	// the first lock of every write that changes anything the board shows
	// (lock order: board, then list, then card; see docs/db-contract.md).
	// It serialises writes per board, so concurrent writers cannot deadlock on
	// the board row that Touch and the list/card writes also reach.
	// ErrNotFound if the board is absent.
	// SQL: SELECT id FROM boards WHERE id = $1 FOR UPDATE.
	Lock(ctx context.Context, boardID int64) error

	// Touch sets boards.updated_at, which is the board's ETag source.
	// SQL: UPDATE boards SET updated_at = $2 WHERE id = $1.
	Touch(ctx context.Context, boardID int64, at time.Time) error
}

type ListRepo interface {
	// Create assigns ID and stores l.
	// SQL: INSERT INTO lists ... RETURNING id.
	Create(ctx context.Context, l List) (List, error)

	// ByBoard returns every list of the board, archived included, ordered by
	// position.
	// SQL: SELECT ... FROM lists WHERE board_id = $1 ORDER BY position COLLATE "C".
	ByBoard(ctx context.Context, boardID int64) ([]List, error)

	// Get returns ErrNotFound for a missing list.
	// SQL: SELECT ... FROM lists WHERE id = $1.
	Get(ctx context.Context, id int64) (List, error)

	// Save overwrites every column of an existing list; ErrNotFound if absent.
	// SQL: UPDATE lists SET all columns WHERE id = $1.
	Save(ctx context.Context, l List) error

	// Positions returns every list of the board, archived included, ordered
	// by position.
	// Archived rows are flagged.
	// SQL: SELECT id, position, archived_at IS NOT NULL FROM lists WHERE board_id = $1 ORDER BY position COLLATE "C".
	Positions(ctx context.Context, boardID int64) ([]IDPos, error)

	// SetPositions rewrites the position of each listed list. The unique
	// index (board_id, position) is not deferrable, so a plain UPDATE can
	// collide mid-statement.
	// SQL: step 1 (park) UPDATE lists SET position = '~' || id WHERE id = ANY($1)
	// OR (board_id IN (SELECT board_id FROM lists WHERE id = ANY($1)) AND position = ANY($newPositions)
	// AND id <> ALL($1) AND archived_at IS NULL); the container is found from the rows themselves, and the
	// one parked row outside ps is the moving row, which the caller Saves with its
	// new position in the same transaction;
	// step 2 UPDATE lists SET position = v.position FROM (VALUES ...) v WHERE lists.id = v.id.
	SetPositions(ctx context.Context, ps []IDPos) error

	// Archived returns the board's archived lists (ordered by position) and
	// its archived cards (ordered by position, then id).
	// SQL: SELECT ... FROM lists WHERE board_id = $1 AND archived_at IS NOT NULL;
	// cards JOIN lists ON list_id WHERE lists.board_id = $1 AND cards.archived_at IS NOT NULL.
	Archived(ctx context.Context, boardID int64) ([]List, []CardSummary, error)
}

type CardRepo interface {
	// Create assigns ID and stores c as given.
	// SQL: INSERT INTO cards ... RETURNING id.
	Create(ctx context.Context, c Card) (Card, error)

	// Get returns ErrNotFound for a missing card.
	// SQL: SELECT ... FROM cards WHERE id = $1.
	Get(ctx context.Context, id int64) (Card, error)

	// Save overwrites every column of an existing card; ErrNotFound if absent.
	// SQL: UPDATE cards SET all columns WHERE id = $1.
	Save(ctx context.Context, c Card) error

	// SetCompletedForList sets completed_at on the list's active cards. A
	// non-nil at is written only to cards that have none; nil clears it on
	// every active card.
	// SQL: UPDATE cards SET completed_at = $2 WHERE list_id = $1 AND archived_at IS NULL
	// AND completed_at IS NULL (non-nil at) | AND completed_at IS NOT NULL (nil at).
	SetCompletedForList(ctx context.Context, listID int64, at *time.Time) error

	// Touch sets cards.updated_at; used when only a child row changed.
	// SQL: UPDATE cards SET updated_at = $2 WHERE id = $1.
	Touch(ctx context.Context, cardID int64, at time.Time) error

	// LockList serialises position changes in one list for the rest of the
	// transaction. ErrNotFound if the list is absent.
	// SQL: SELECT id FROM lists WHERE id = $1 FOR UPDATE.
	LockList(ctx context.Context, listID int64) error

	// Positions returns every card of the list, archived included and
	// flagged, ordered by position then id.
	// SQL: SELECT id, position, archived_at IS NOT NULL FROM cards WHERE list_id = $1
	// ORDER BY position COLLATE "C", id.
	Positions(ctx context.Context, listID int64) ([]IDPos, error)

	// SetPositions rewrites the position of each listed card. The unique
	// index (list_id, position) is not deferrable, so use the two-step update.
	// SQL: step 1 (park) UPDATE cards SET position = '~' || id WHERE id = ANY($1)
	// OR (list_id IN (SELECT list_id FROM cards WHERE id = ANY($1)) AND position = ANY($newPositions)
	// AND id <> ALL($1) AND archived_at IS NULL); the container is found from the rows themselves, and the
	// one parked row outside ps is the moving row, which the caller Saves with its
	// new position in the same transaction;
	// step 2 UPDATE cards SET position = v.position FROM (VALUES ...) v WHERE cards.id = v.id.
	SetPositions(ctx context.Context, ps []IDPos) error

	// AddAssignee reports whether a row was added; an existing one is left
	// alone (false).
	// SQL: INSERT INTO card_assignees (card_id, user_id, assigned_at) VALUES (...)
	// ON CONFLICT DO NOTHING; added = rows affected is 1.
	AddAssignee(ctx context.Context, cardID, userID int64, at time.Time) (bool, error)

	// RemoveAssignee reports whether a row was removed.
	// SQL: DELETE FROM card_assignees WHERE card_id = $1 AND user_id = $2;
	// removed = rows affected is 1.
	RemoveAssignee(ctx context.Context, cardID, userID int64) (bool, error)

	// AddLabel reports whether a row was added; an existing one is left alone
	// (false). ErrNotFound if the card is absent.
	// SQL: INSERT INTO card_labels (card_id, label_id) VALUES (...)
	// ON CONFLICT DO NOTHING; added = rows affected is 1.
	AddLabel(ctx context.Context, cardID, labelID int64) (bool, error)

	// RemoveLabel reports whether a row was removed.
	// SQL: DELETE FROM card_labels WHERE card_id = $1 AND label_id = $2;
	// removed = rows affected is 1.
	RemoveLabel(ctx context.Context, cardID, labelID int64) (bool, error)

	// Children returns what the card detail shows besides the card row:
	// assignee ids and label ids ascending, checklist items by position.
	// Return empty slices, never nil, for a card without rows (the service
	// also guards, but the contract is "never nil").
	// SQL: three queries by card_id (card_assignees, card_labels,
	// checklist_items ORDER BY position COLLATE "C").
	Children(ctx context.Context, cardID int64) (CardChildren, error)
}

// CardChildren is the child data of one card, read for the detail view.
type CardChildren struct {
	AssigneeIDs []int64
	LabelIDs    []int64
	Checklist   []ChecklistItem
}

// IDPos is a row id with its LexoRank position. Archived is filled by the
// Positions readers (archived rows stay in the key space but cannot be
// neighbours); writers ignore it.
type IDPos struct {
	ID       int64
	Position string
	Archived bool
}
