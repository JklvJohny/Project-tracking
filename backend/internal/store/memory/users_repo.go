package memory

import (
	"context"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

type userRolesRepo struct{ d *data }

func (r *userRolesRepo) Get(_ context.Context, userID int64) (*store.UserRole, error) {
	ur, ok := r.d.userRoles[userID]
	if !ok {
		return nil, nil
	}
	return &ur, nil
}

type usersRepo struct {
	d   *data
	now clock.Clock
}

func (r *usersRepo) Upsert(_ context.Context, us []store.CachedUser) error {
	for _, u := range us {
		if u.SyncedAt.IsZero() {
			u.SyncedAt = r.now()
		}
		r.d.userCache[u.UserID] = u
	}
	return nil
}

func (r *usersRepo) Get(_ context.Context, ids []int64) ([]store.CachedUser, error) {
	out := make([]store.CachedUser, 0, len(ids))
	for _, id := range ids {
		if u, ok := r.d.userCache[id]; ok {
			out = append(out, u)
		}
	}
	return out, nil
}
