package store

import (
	"encoding/json"
	"time"
)

// Date is a calendar date, YYYY-MM-DD, with no time zone.
// SQL: DATE column.
type Date string

// All fields mirror docs/ERD.md. Nullable columns are pointers. Every id,
// including user ids, is int64.

type UserRole struct {
	UserID    int64
	Role      string // admin | manager
	GrantedAt time.Time
	GrantedBy int64
}

// CachedUser is a copy of a user-service user, kept for names and @mentions.
type CachedUser struct {
	UserID      int64
	DisplayName string
	Handle      string
	AvatarURL   string
	SyncedAt    time.Time
}

type Project struct {
	ID          int64
	Name        string
	Description string
	OwnerID     int64
	Status      string // active | on_hold | done
	StartDate   *Date
	EndDate     *Date
	CreatedBy   int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ArchivedAt  *time.Time
}

type Member struct {
	ProjectID int64
	UserID    int64
	Role      string // pm | member | viewer
	AddedAt   time.Time
}

type Board struct {
	ID        int64
	ProjectID int64
	UpdatedAt time.Time
}

type List struct {
	ID         int64
	BoardID    int64
	Name       string
	Position   string // LexoRank
	IsDone     bool
	WIPLimit   *int
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ArchivedAt *time.Time
}

type Card struct {
	ID          int64
	ListID      int64
	Title       string
	Description string // description_md
	Priority    int16  // 0 low, 1 medium, 2 high, 3 urgent
	StartDate   *Date
	DueDate     *Date
	Position    string // LexoRank
	CreatedBy   int64
	CreatedAt   time.Time
	CompletedAt *time.Time
	UpdatedAt   time.Time
	ArchivedAt  *time.Time
}

// CardSummary is what a board shows for a card: no description, and counts
// instead of child rows.
type CardSummary struct {
	ID             int64
	ListID         int64
	Title          string
	Priority       int16
	StartDate      *Date
	DueDate        *Date
	Position       string
	CompletedAt    *time.Time
	ArchivedAt     *time.Time
	UpdatedAt      time.Time
	LabelIDs       []int64
	AssigneeIDs    []int64
	ChecklistTotal int
	ChecklistDone  int
	CommentCount   int
}

type CardAssignee struct {
	CardID     int64
	UserID     int64
	AssignedAt time.Time
}

type CardLabel struct {
	CardID  int64
	LabelID int64
}

type Label struct {
	ID        int64
	ProjectID int64
	Name      string
	Color     string // green | yellow | red | blue | purple | gray
}

type ChecklistItem struct {
	ID        int64
	CardID    int64
	Text      string
	IsDone    bool
	Position  string // LexoRank
	UpdatedAt time.Time
}

type Comment struct {
	ID        int64
	CardID    int64
	AuthorID  int64
	Body      string // body_md
	CreatedAt time.Time
	EditedAt  *time.Time
	DeletedAt *time.Time
}

type CommentMention struct {
	CommentID int64
	UserID    int64
}

// ActivityEvent is the audit trail. Payload holds changed ids and values only,
// never names, titles or row snapshots.
type ActivityEvent struct {
	ID        int64
	ProjectID int64
	CardID    *int64
	ActorID   int64
	Type      string // card.moved, card.updated, ...
	Payload   json.RawMessage
	CreatedAt time.Time
}

// BoardSnapshot is the read model behind GET /projects/{id}/board.
type BoardSnapshot struct {
	Board   Board
	Project Project
	Lists   []List
	Cards   []CardSummary
	Labels  []Label
	Members []Member
	Users   []CachedUser
}
