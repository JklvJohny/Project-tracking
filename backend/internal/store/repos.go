package store

import "context"

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
	ProjectRepo   interface{}
	MemberRepo    interface{}
	BoardRepo     interface{}
	ListRepo      interface{}
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
}

type ActivityRepo interface {
	// Append records one event; the store assigns ID and, when CreatedAt is
	// zero, sets it to now. Must run in the same transaction as the change it
	// describes.
	// SQL: INSERT INTO activity_events (project_id, card_id, actor_id, type, payload, created_at) ...;
	// payload is changed ids/values only.
	Append(ctx context.Context, e ActivityEvent) error
}
