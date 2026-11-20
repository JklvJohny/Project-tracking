package memory

import (
	"cmp"
	"context"
	"slices"

	"tracking-service/internal/store"
)

type avatarRepo struct{ d *data }

func (r *avatarRepo) Get(_ context.Context, userID int64) (store.UserAvatar, error) {
	a, ok := r.d.avatars[userID]
	if !ok {
		return store.UserAvatar{}, store.ErrNotFound
	}
	return a, nil
}

func (r *avatarRepo) All(_ context.Context) ([]store.UserAvatar, error) {
	out := make([]store.UserAvatar, 0, len(r.d.avatars))
	for _, a := range r.d.avatars {
		out = append(out, a)
	}
	slices.SortFunc(out, func(a, b store.UserAvatar) int { return cmp.Compare(a.UserID, b.UserID) })
	return out, nil
}

func (r *avatarRepo) Set(_ context.Context, a store.UserAvatar) error {
	r.d.avatars[a.UserID] = a
	return nil
}

func (r *avatarRepo) Delete(_ context.Context, userID int64) error {
	if _, ok := r.d.avatars[userID]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.avatars, userID)
	return nil
}
