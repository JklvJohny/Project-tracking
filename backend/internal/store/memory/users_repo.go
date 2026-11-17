package memory

import (
	"context"
	"sort"
	"time"

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

func (r *usersRepo) Stale(_ context.Context, before time.Time, limit int) ([]int64, error) {
	var stale []store.CachedUser
	for _, u := range r.d.userCache {
		if u.SyncedAt.Before(before) {
			stale = append(stale, u)
		}
	}
	sort.Slice(stale, func(i, j int) bool {
		if !stale[i].SyncedAt.Equal(stale[j].SyncedAt) {
			return stale[i].SyncedAt.Before(stale[j].SyncedAt)
		}
		return stale[i].UserID < stale[j].UserID
	})
	ids := []int64{}
	for _, u := range stale {
		if len(ids) == limit {
			break
		}
		ids = append(ids, u.UserID)
	}
	return ids, nil
}
