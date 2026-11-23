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

// A document already in the asked state is left alone, so two people deleting
// it at once log one event.
func TestDocuments_SetDeletedReportsAChangeOnce(t *testing.T) {
	s := newStore()
	ctx := context.Background()
	err := s.Update(ctx, func(r store.Repos) error {
		d, err := r.Documents.Create(ctx, store.Document{ProjectID: 1, StorageKey: "k", Filename: "a.pdf"})
		if err != nil {
			return err
		}
		at := t0
		for i, want := range []bool{true, false} {
			if changed, err := r.Documents.SetDeleted(ctx, d.ID, &at); err != nil || changed != want {
				t.Errorf("delete #%d: changed %v err %v, want %v", i+1, changed, err, want)
			}
		}
		if changed, _ := r.Documents.SetDeleted(ctx, d.ID, nil); !changed {
			t.Error("restore did not report a change")
		}
		if _, err := r.Documents.SetDeleted(ctx, 999, nil); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("missing = %v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Like ux_projects_name: live names are unique ignoring case, so a write that
// slips past the service's NameTaken check (a race) still fails as a duplicate.
func TestProjects_LiveNamesAreUnique(t *testing.T) {
	s := newStore()
	ctx := context.Background()
	err := s.Update(ctx, func(r store.Repos) error {
		a, err := r.Projects.Create(ctx, store.Project{Name: "Website"})
		if err != nil {
			return err
		}
		if _, err := r.Projects.Create(ctx, store.Project{Name: "website"}); !errors.Is(err, store.ErrDuplicate) {
			t.Errorf("second live Website = %v", err)
		}
		at := t0
		a.ArchivedAt = &at
		if err := r.Projects.Save(ctx, a); err != nil {
			return err
		}
		b, err := r.Projects.Create(ctx, store.Project{Name: "Website"})
		if err != nil {
			t.Errorf("reuse an archived name: %v", err)
		}
		a.ArchivedAt = nil // restoring the old one now clashes
		if err := r.Projects.Save(ctx, a); !errors.Is(err, store.ErrDuplicate) {
			t.Errorf("restore over a live name = %v (b=%d)", err, b.ID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
