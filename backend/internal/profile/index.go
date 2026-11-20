package profile

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tracking-service/internal/httpx"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
)

// Index maps user ids to their tracking avatar URL, in process memory.
//
// Services call users.Provider inside Store.Update (to refresh user_cache), so
// the provider wrapper cannot read the store itself: the memory store's lock
// is not reentrant. The index is filled from AvatarRepo.All at start-up and
// changed only by this package. With more than one tracking-service instance,
// an upload reaches the others on their next Load, so call Load on a timer
// there (see docs/db-contract.md).
type Index struct {
	mu   sync.RWMutex
	urls map[int64]string
}

func NewIndex() *Index { return &Index{urls: map[int64]string{}} }

// URL is the address a tracking avatar is served from. The version changes
// with every upload, so a browser may cache each address for good.
func URL(userID int64, updated time.Time) string {
	return fmt.Sprintf("%s/users/%d/avatar?v=%d", httpx.BasePath, userID, updated.UnixMilli())
}

// Load replaces the index with what the store holds.
func (x *Index) Load(ctx context.Context, st store.Store) error {
	var all []store.UserAvatar
	if err := st.View(ctx, func(r store.Repos) error {
		var err error
		all, err = r.Avatars.All(ctx)
		return err
	}); err != nil {
		return err
	}
	urls := make(map[int64]string, len(all))
	for _, a := range all {
		urls[a.UserID] = URL(a.UserID, a.UpdatedAt)
	}
	x.mu.Lock()
	x.urls = urls
	x.mu.Unlock()
	return nil
}

func (x *Index) set(userID int64, url string) {
	x.mu.Lock()
	defer x.mu.Unlock()
	if url == "" {
		delete(x.urls, userID)
	} else {
		x.urls[userID] = url
	}
}

func (x *Index) apply(us []users.User) []users.User {
	x.mu.RLock()
	defer x.mu.RUnlock()
	for i, u := range us {
		if url, ok := x.urls[u.ID]; ok {
			us[i].AvatarURL = url
		}
	}
	return us
}

// Wrap returns p with tracking avatars in place of the user-service ones.
// Every service gets the wrapped provider, so user_cache and every view carry
// them.
func (x *Index) Wrap(p users.Provider) users.Provider { return wrapped{p: p, x: x} }

type wrapped struct {
	p users.Provider
	x *Index
}

func (w wrapped) Get(ctx context.Context, ids []int64) ([]users.User, error) {
	us, err := w.p.Get(ctx, ids)
	return w.x.apply(us), err
}

func (w wrapped) Search(ctx context.Context, q string, limit int) ([]users.User, error) {
	us, err := w.p.Search(ctx, q, limit)
	return w.x.apply(us), err
}

func (w wrapped) Department(ctx context.Context, limit int) ([]users.User, error) {
	us, err := w.p.Department(ctx, limit)
	return w.x.apply(us), err
}
