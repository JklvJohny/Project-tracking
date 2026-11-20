// Package profile serves the signed-in user's own picture, uploaded in
// tracking. The rest of the Profile page reads existing endpoints (team for
// skills and workload, me/tasks for the calendar).
package profile

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"tracking-service/internal/apperr"
	"tracking-service/internal/blob"
	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
)

type Service struct {
	st    store.Store
	blobs blob.Store
	// raw is user-service itself, not wrapped: removing a tracking avatar
	// brings the user-service one back.
	raw users.Provider
	idx *Index
	now clock.Clock
}

func New(st store.Store, blobs blob.Store, raw users.Provider, idx *Index, now clock.Clock) *Service {
	return &Service{st: st, blobs: blobs, raw: raw, idx: idx, now: now}
}

// SetAvatar stores the caller's new picture and returns its URL. The old file
// is removed once the new one is committed.
func (s *Service) SetAvatar(ctx context.Context, userID int64, r io.Reader) (string, error) {
	img, err := normalize(r)
	if err != nil {
		return "", err
	}
	now := s.now()
	key := fmt.Sprintf("avatars/%d/%d.jpg", userID, now.UnixNano())
	if _, err := s.blobs.Put(ctx, key, bytes.NewReader(img)); err != nil {
		return "", err
	}
	url := URL(userID, now)
	var old string
	err = s.st.Update(ctx, func(r store.Repos) error {
		prev, err := r.Avatars.Get(ctx, userID)
		switch {
		case err == nil:
			old = prev.StorageKey
		case !errors.Is(err, store.ErrNotFound):
			return err
		}
		if err := r.Avatars.Set(ctx, store.UserAvatar{UserID: userID, StorageKey: key, UpdatedAt: now}); err != nil {
			return err
		}
		return setCachedAvatar(ctx, r, userID, url)
	})
	if err != nil {
		s.dropBlob(ctx, key)
		return "", err
	}
	s.idx.set(userID, url)
	if old != "" {
		s.dropBlob(ctx, old)
	}
	return url, nil
}

// DeleteAvatar removes the caller's tracking picture and returns the
// user-service avatar URL that shows again ("" if none).
func (s *Service) DeleteAvatar(ctx context.Context, userID int64) (string, error) {
	// Outside the transaction: the provider may call user-service over the network.
	var fallback string
	if found, err := s.raw.Get(ctx, []int64{userID}); err == nil && len(found) > 0 {
		fallback = found[0].AvatarURL
	}
	var key string
	err := s.st.Update(ctx, func(r store.Repos) error {
		a, err := r.Avatars.Get(ctx, userID)
		if err != nil {
			return err
		}
		key = a.StorageKey
		if err := r.Avatars.Delete(ctx, userID); err != nil {
			return err
		}
		return setCachedAvatar(ctx, r, userID, fallback)
	})
	if errors.Is(err, store.ErrNotFound) {
		return "", apperr.NotFound("avatar")
	}
	if err != nil {
		return "", err
	}
	s.idx.set(userID, "")
	s.dropBlob(ctx, key)
	return fallback, nil
}

// Open returns the picture of userID. Any signed-in user may see anyone's:
// avatars show next to names on every shared page.
func (s *Service) Open(ctx context.Context, userID int64) (io.ReadCloser, error) {
	var key string
	err := s.st.View(ctx, func(r store.Repos) error {
		a, err := r.Avatars.Get(ctx, userID)
		key = a.StorageKey
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		return nil, apperr.NotFound("avatar")
	}
	if err != nil {
		return nil, err
	}
	rc, err := s.blobs.Open(ctx, key)
	if errors.Is(err, blob.ErrNotFound) {
		return nil, apperr.NotFound("avatar")
	}
	return rc, err
}

// setCachedAvatar points the user_cache row of userID (when there is one) at
// url, so pages that read the cache show the change at once.
func setCachedAvatar(ctx context.Context, r store.Repos, userID int64, url string) error {
	cached, err := r.Users.Get(ctx, []int64{userID})
	if err != nil || len(cached) == 0 {
		return err
	}
	c := cached[0]
	c.AvatarURL = url
	return r.Users.Upsert(ctx, []store.CachedUser{c})
}

func (s *Service) dropBlob(ctx context.Context, key string) {
	if err := s.blobs.Delete(ctx, key); err != nil {
		slog.Warn("avatar blob cleanup failed", "key", key, "err", err)
	}
}
