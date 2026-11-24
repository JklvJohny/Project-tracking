package postgres_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/store/storetest"
)

// These check what only a real database can get wrong; the service tests cover
// the rest on both stores. They need TRACKING_TEST_DATABASE_URL.
func pg(t *testing.T) storetest.Store {
	t.Helper()
	if !storetest.Postgres() {
		t.Skip("TRACKING_TEST_DATABASE_URL not set")
	}
	return storetest.New(t, clock.UTC)
}

type fixture struct {
	project store.Project
	list    store.List
	cards   []store.Card
}

func setup(t *testing.T, st store.Store, cards int) fixture {
	t.Helper()
	ctx := context.Background()
	var f fixture
	at := clock.UTC()
	if err := st.Update(ctx, func(r store.Repos) error {
		start, end := store.Date("2026-11-01"), store.Date("2026-12-31")
		p, err := r.Projects.Create(ctx, store.Project{Name: "P", Status: "active", OwnerID: 1, CreatedBy: 1,
			StartDate: &start, EndDate: &end, CreatedAt: at, UpdatedAt: at})
		if err != nil {
			return err
		}
		b, err := r.Boards.Create(ctx, store.Board{ProjectID: p.ID, UpdatedAt: at})
		if err != nil {
			return err
		}
		l, err := r.Lists.Create(ctx, store.List{BoardID: b.ID, Name: "L", Position: "m", CreatedAt: at, UpdatedAt: at})
		if err != nil {
			return err
		}
		f.project, f.list = p, l
		for i := 0; i < cards; i++ {
			c, err := r.Cards.Create(ctx, store.Card{ListID: l.ID, Title: "c", Position: string(rune('a' + i)),
				Priority: 1, CreatedBy: 1, CreatedAt: at, UpdatedAt: at})
			if err != nil {
				return err
			}
			f.cards = append(f.cards, c)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// Timestamps come back exactly as written and in UTC although the role's
// session zone is Asia/Bangkok; dates come back as the same calendar day.
func TestRoundTrip_TimesInUTCAndDates(t *testing.T) {
	st := pg(t)
	f := setup(t, st, 0)
	_ = st.View(context.Background(), func(r store.Repos) error {
		p, err := r.Projects.Get(context.Background(), f.project.ID)
		if err != nil {
			t.Fatal(err)
		}
		if p.CreatedAt.Location() != time.UTC || !p.CreatedAt.Equal(f.project.CreatedAt) {
			t.Errorf("created_at = %v, want %v in UTC", p.CreatedAt, f.project.CreatedAt)
		}
		if *p.StartDate != "2026-11-01" || *p.EndDate != "2026-12-31" {
			t.Errorf("dates = %v %v", *p.StartDate, *p.EndDate)
		}
		return nil
	})
}

// Reversing a list's order rewrites keys that collide mid-update without the
// two-step park; the unique index must not trip.
func TestSetPositions_ReverseOrder(t *testing.T) {
	st := pg(t)
	f := setup(t, st, 3)
	ctx := context.Background()
	if err := st.Update(ctx, func(r store.Repos) error {
		return r.Cards.SetPositions(ctx, []store.IDPos{
			{ID: f.cards[0].ID, Position: "c"}, {ID: f.cards[1].ID, Position: "b"}, {ID: f.cards[2].ID, Position: "a"},
		})
	}); err != nil {
		t.Fatal(err)
	}
	_ = st.View(ctx, func(r store.Repos) error {
		ps, _ := r.Cards.Positions(ctx, f.list.ID)
		if len(ps) != 3 || ps[0].ID != f.cards[2].ID || ps[2].ID != f.cards[0].ID {
			t.Errorf("positions = %+v", ps)
		}
		return nil
	})
}

// A unique index catches what a check-then-write race lets through.
func TestProjects_DuplicateLiveName(t *testing.T) {
	st := pg(t)
	setup(t, st, 0)
	ctx := context.Background()
	err := st.Update(ctx, func(r store.Repos) error {
		_, err := r.Projects.Create(ctx, store.Project{Name: "p", Status: "active", OwnerID: 1, CreatedBy: 1})
		return err
	})
	if err != store.ErrDuplicate {
		t.Fatalf("err = %v, want ErrDuplicate", err)
	}
}

// Twenty writers bump one board at once; the row lock makes them queue, so
// none fails and none is lost.
func TestUpdate_ConcurrentWritersQueueOnTheBoardLock(t *testing.T) {
	st := pg(t)
	f := setup(t, st, 0)
	ctx := context.Background()
	var b store.Board
	_ = st.View(ctx, func(r store.Repos) (err error) { b, err = r.Boards.ByProject(ctx, f.project.ID); return err })
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs <- st.Update(ctx, func(r store.Repos) error {
				if err := r.Boards.Lock(ctx, b.ID); err != nil {
					return err
				}
				_, err := r.Cards.Create(ctx, store.Card{ListID: f.list.ID, Title: "c", Position: string(rune('A' + i)),
					CreatedBy: 1, CreatedAt: clock.UTC(), UpdatedAt: clock.UTC()})
				return err
			})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	_ = st.View(ctx, func(r store.Repos) error {
		if ps, _ := r.Cards.Positions(ctx, f.list.ID); len(ps) != 20 {
			t.Errorf("cards = %d, want 20", len(ps))
		}
		return nil
	})
}
