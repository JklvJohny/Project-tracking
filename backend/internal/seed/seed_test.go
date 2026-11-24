package seed_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"tracking-service/internal/board"
	"tracking-service/internal/events"
	"tracking-service/internal/seed"
	"tracking-service/internal/store/storetest"
	"tracking-service/internal/users"
)

func seeded(t *testing.T, large bool) (storetest.Store, *board.Service) {
	t.Helper()
	st := storetest.New(t, time.Now)
	if err := seed.Seed(st, time.Now, users.NewStub(), large); err != nil {
		t.Fatal(err)
	}
	return st, board.New(st, events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil))), time.Now)
}

func TestSeed_PrototypeData(t *testing.T) {
	_, b := seeded(t, false)
	ctx := context.Background()
	v, role, err := b.Board(ctx, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if role != "pm" || len(v.Lists) != 4 || len(v.Cards) != 12 || len(v.Labels) != 6 {
		t.Fatalf("role=%s lists=%d cards=%d labels=%d", role, len(v.Lists), len(v.Cards), len(v.Labels))
	}
	roles := map[int64]string{}
	for _, m := range v.Members {
		roles[m.UserID] = m.Role
	}
	if roles[2] != "pm" || roles[3] != "member" || roles[4] != "member" || roles[5] != "member" || roles[6] != "member" {
		t.Fatalf("members: %v", roles)
	}
	done := 0
	for _, c := range v.Cards {
		if c.CompletedAt != nil {
			done++
		}
	}
	if done != 2 {
		t.Fatalf("completed cards = %d, want 2", done)
	}
	if _, role, err := b.Board(ctx, 1, 2); err != nil || role != "admin" {
		t.Fatalf("admin sees project 2: role=%s err=%v", role, err)
	}
	if _, _, err := b.Board(ctx, 3, 2); err == nil {
		t.Fatal("user 3 is not in project 2")
	}
}

func TestSeed_Large(t *testing.T) {
	_, b := seeded(t, true)
	v, _, err := b.Board(context.Background(), 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	if v.Project.Name != "Load Test" || len(v.Lists) != 8 || len(v.Cards) != 2000 {
		t.Fatalf("%q lists=%d cards=%d", v.Project.Name, len(v.Lists), len(v.Cards))
	}
}
