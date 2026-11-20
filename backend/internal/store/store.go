// Package store is the persistence contract. Services run inside View/Update
// and never see how data is kept. The in-memory implementation (store/memory)
// is for local development and tests; the PostgreSQL implementation is
// written separately and must honour every "SQL:" obligation in repos.go.
package store

import (
	"context"
	"errors"
)

// ErrNotFound is returned by a repo for a missing row. Services turn it into
// apperr.NotFound.
var ErrNotFound = errors.New("store: not found")

// ErrDuplicate is returned by a repo when a write breaks a unique index.
// SQL: unique_violation (23505).
var ErrDuplicate = errors.New("store: duplicate")

// Store runs units of work against a consistent view of the data.
//
// View callbacks are read-only: never call a write method inside View.
// View and Update must not be nested; the memory store's lock is not
// reentrant, so a nested call deadlocks.
type Store interface {
	// View runs fn read-only.
	// SQL: BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY ... COMMIT, so one
	// request sees one snapshot across several queries.
	View(ctx context.Context, fn func(Repos) error) error

	// Update runs fn as one atomic unit: every write fn makes, including its
	// activity event, becomes visible together or not at all.
	// SQL: BEGIN ... COMMIT when fn returns nil, ROLLBACK when it returns an error.
	Update(ctx context.Context, fn func(Repos) error) error
}
