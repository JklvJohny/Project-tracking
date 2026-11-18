package memory_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
)

var t0 = time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)

func newStore() *memory.Store { return memory.New(clock.Fixed(t0)) }

func appendEvent(ctx context.Context, r store.Repos) error {
	return r.Activity.Append(ctx, store.ActivityEvent{ProjectID: 1, ActorID: 2, Type: "card.created"})
}

func TestUpdate_RollsBackOnError(t *testing.T) {
	s := newStore()
	boom := errors.New("boom")
	err := s.Update(context.Background(), func(r store.Repos) error {
		if e := appendEvent(context.Background(), r); e != nil {
			return e
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.Activity()); n != 0 {
		t.Fatalf("activity after rollback = %d", n)
	}
}

func TestUpdate_CommitsOnNil(t *testing.T) {
	s := newStore()
	if err := s.Update(context.Background(), func(r store.Repos) error {
		return appendEvent(context.Background(), r)
	}); err != nil {
		t.Fatal(err)
	}
	ev := s.Activity()
	if len(ev) != 1 || ev[0].ID == 0 || !ev[0].CreatedAt.Equal(t0) {
		t.Fatalf("activity = %+v", ev)
	}
}

func TestView_SeesCommitted(t *testing.T) {
	s := newStore()
	ctx := context.Background()
	_ = s.Update(ctx, func(r store.Repos) error {
		return r.Users.Upsert(ctx, []store.CachedUser{{UserID: 7, DisplayName: "สมชาย", Handle: "somchai"}})
	})
	err := s.View(ctx, func(r store.Repos) error {
		got, err := r.Users.Get(ctx, []int64{7, 99})
		if err != nil {
			return err
		}
		if len(got) != 1 || got[0].DisplayName != "สมชาย" || !got[0].SyncedAt.Equal(t0) {
			t.Fatalf("got %+v", got)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestUserRoles_GetMissingIsNil(t *testing.T) {
	s := newStore()
	_ = s.View(context.Background(), func(r store.Repos) error {
		ur, err := r.UserRoles.Get(context.Background(), 1)
		if err != nil || ur != nil {
			t.Fatalf("got %v, %v", ur, err)
		}
		return nil
	})
}

func TestUpdate_CopyIsIsolatedFromCommitted(t *testing.T) {
	s := newStore()
	ctx := context.Background()
	_ = s.Update(ctx, func(r store.Repos) error {
		return r.Users.Upsert(ctx, []store.CachedUser{{UserID: 1, DisplayName: "a"}})
	})
	_ = s.Update(ctx, func(r store.Repos) error {
		_ = r.Users.Upsert(ctx, []store.CachedUser{{UserID: 1, DisplayName: "changed"}})
		return errors.New("abort")
	})
	_ = s.View(ctx, func(r store.Repos) error {
		got, _ := r.Users.Get(ctx, []int64{1})
		if got[0].DisplayName != "a" {
			t.Fatalf("rolled-back write leaked: %+v", got)
		}
		return nil
	})
}
