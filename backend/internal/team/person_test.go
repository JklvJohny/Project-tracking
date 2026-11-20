package team_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
)

// peopleFixture: user 2 (manager) is PM of "Alpha"; user 6 (manager) is PM of
// "Beta", which user 2 is not in. User 4 works in both, user 5 only in Alpha.
// User 4 has one open card in each project, one of them overdue.
func peopleFixture(t *testing.T, e env) {
	t.Helper()
	ctx := context.Background()
	e.st.SeedUserRole(store.UserRole{UserID: 1, Role: "admin"})
	e.st.SeedUserRole(store.UserRole{UserID: 2, Role: "manager"})
	e.st.SeedUserRole(store.UserRole{UserID: 6, Role: "manager"})
	up := users.NewStub()
	ev := events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil)))
	nowFn := func() time.Time { return now }
	projects := project.New(e.st, up, ev, nowFn)
	boards := board.New(e.st, ev, nowFn)
	cards := card.New(e.st, up, ev, nowFn)
	mk := func(pm int64, name string, members []int64, title, start, due string) {
		p, err := projects.Create(ctx, pm, project.CreateProjectInput{Name: name, Lang: "en"})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range members {
			if _, err := projects.AddMember(ctx, pm, p.ID, m, "member"); err != nil {
				t.Fatal(err)
			}
		}
		v, _, err := boards.Board(ctx, pm, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		c, err := cards.Create(ctx, pm, v.Lists[0].ID, card.CreateCardInput{Title: title})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := cards.Update(ctx, pm, c.ID, card.UpdateCardInput{StartDate: card.SetDate(&start), DueDate: card.SetDate(&due)}); err != nil {
			t.Fatal(err)
		}
		if _, err := cards.Assign(ctx, pm, c.ID, 4); err != nil {
			t.Fatal(err)
		}
	}
	mk(2, "Alpha", []int64{4, 5}, "Pricing page", "2026-11-10", "2026-11-16")
	mk(6, "Beta", []int64{4}, "Plant HMI", "2026-11-18", "2026-11-28")
}

func TestPerson_PMsAndAdminsSeeEveryProjectOfAPerson(t *testing.T) {
	e := newEnv(t)
	peopleFixture(t, e)
	for _, viewer := range []int64{2, 1} {
		code, body := e.call(viewer, "GET", "/people/4", "")
		if code != 200 {
			t.Fatalf("viewer %d: GET /people/4 = %d %v", viewer, code, body)
		}
		d := body["data"].(map[string]any)
		ps := d["projects"].([]any)
		// Beta is shown to user 2 although they are not in it: the owner's call.
		if len(ps) != 2 || ps[0].(map[string]any)["name"] != "Alpha" || ps[1].(map[string]any)["name"] != "Beta" {
			t.Fatalf("viewer %d: projects = %v", viewer, ps)
		}
		if ps[1].(map[string]any)["role"] != "member" || ps[1].(map[string]any)["open"] != 1.0 {
			t.Fatalf("beta = %v", ps[1])
		}
		if tasks := d["tasks"].([]any); len(tasks) != 2 {
			t.Fatalf("tasks = %v", tasks)
		}
		p := d["person"].(map[string]any)
		// Today is 2026-11-18 in Bangkok: Pricing page (due 16th) is overdue, Plant HMI is not due within 7 days.
		if p["open"] != 2.0 || p["overdue"] != 1.0 || p["dueSoon"] != 0.0 {
			t.Fatalf("person = %v", p)
		}
	}
}

func TestPerson_OthersSeeOnlyThemselves(t *testing.T) {
	e := newEnv(t)
	peopleFixture(t, e)
	if code, body := e.call(5, "GET", "/people/4", ""); code != 403 {
		t.Fatalf("member viewing another = %d %v, want 403", code, body)
	}
	if code, body := e.call(5, "GET", "/people/5", ""); code != 200 {
		t.Fatalf("own page = %d %v", code, body)
	}
	if code, _ := e.call(2, "GET", "/people/99", ""); code != 404 {
		t.Fatalf("unknown user = %d", code)
	}
	if code, _ := e.call(2, "GET", "/people/x", ""); code != 400 {
		t.Fatalf("bad id = %d", code)
	}
}
