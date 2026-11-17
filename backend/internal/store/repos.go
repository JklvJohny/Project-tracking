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

type (
	CardRepo      interface{}
	LabelRepo     interface{}
	ChecklistRepo interface{}
	CommentRepo   interface{}
)

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
}
