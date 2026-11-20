// Package users is the adapter to user-service, which owns people.
package users

import "context"

type User struct {
	ID        int64
	Name      string
	AvatarURL string
}

// Provider looks users up by id or by free-text search.
type Provider interface {
	Get(ctx context.Context, ids []int64) ([]User, error)
	Search(ctx context.Context, q string, limit int) ([]User, error)
	// Department returns everyone in the department that uses tracking (the
	// Team page lists them), at most limit people.
	Department(ctx context.Context, limit int) ([]User, error)
}
