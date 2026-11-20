package team_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/team"
	"tracking-service/internal/users"
)

type headerAuth struct{}

func (headerAuth) Authenticate(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.Header.Get("X-User-ID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("no user")
	}
	return id, nil
}

// 2026-11-18 01:00 in Bangkok is still the 17th in UTC: "today" must be the Bangkok date.
var now = time.Date(2026, 11, 17, 18, 0, 0, 0, time.UTC)

type env struct {
	h  http.Handler
	st *memory.Store
}

func newEnv(t *testing.T) env {
	t.Helper()
	st := memory.New(func() time.Time { return now })
	svc := team.New(st, users.NewStub(), func() time.Time { return now })
	h := httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(headerAuth{}))
		team.Mount(r, svc)
	})
	return env{h: h, st: st}
}

func (e env) call(user int64, method, path, body string) (int, map[string]any) {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, strings.NewReader(body))
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func person(t *testing.T, body map[string]any, id float64) map[string]any {
	t.Helper()
	for _, p := range body["data"].(map[string]any)["people"].([]any) {
		if m := p.(map[string]any); m["userId"] == id {
			return m
		}
	}
	t.Fatalf("user %v not listed", id)
	return nil
}

func TestTeam_ListsEveryoneByNameWithSkills(t *testing.T) {
	e := newEnv(t)
	code, body := e.call(3, "GET", "/team", "")
	if code != 200 {
		t.Fatalf("GET /team = %d %v", code, body)
	}
	data := body["data"].(map[string]any)
	if data["asOf"] != "2026-11-18" {
		t.Fatalf("asOf = %v, want the Bangkok date", data["asOf"])
	}
	people := data["people"].([]any)
	if len(people) != 8 {
		t.Fatalf("people = %d, want the 8 stub users", len(people))
	}
	if first := people[0].(map[string]any)["name"]; first != "Anan T." {
		t.Fatalf("first = %v, want sorted by name", first)
	}
	if s := person(t, body, 1)["skills"].([]any); len(s) != 0 {
		t.Fatalf("skills = %v, want [] not null", s)
	}
}

func TestTeam_AnyoneEditsSkillsCleanedAndDeduplicated(t *testing.T) {
	e := newEnv(t)
	// User 5 edits user 2: the department keeps the list together.
	code, body := e.call(5, "PUT", "/team/2/skills", `{"skills":["  React ", "go", "React", "", "UX   design", "Go"]}`)
	if code != 200 {
		t.Fatalf("PUT = %d %v", code, body)
	}
	got := body["data"].(map[string]any)["skills"].([]any)
	want := []any{"React", "go", "UX design"}
	if len(got) != len(want) {
		t.Fatalf("skills = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("skills = %v, want %v", got, want)
		}
	}
	_, list := e.call(1, "GET", "/team", "")
	if s := person(t, list, 2)["skills"].([]any); len(s) != 3 {
		t.Fatalf("listed skills = %v", s)
	}
	// An empty list clears them.
	if code, _ := e.call(2, "PUT", "/team/2/skills", `{"skills":[]}`); code != 200 {
		t.Fatalf("clear = %d", code)
	}
	_, list = e.call(1, "GET", "/team", "")
	if s := person(t, list, 2)["skills"].([]any); len(s) != 0 {
		t.Fatalf("after clear = %v", s)
	}
}

func TestTeam_SkillValidation(t *testing.T) {
	e := newEnv(t)
	many := make([]string, 31)
	for i := range many {
		many[i] = `"s` + strconv.Itoa(i) + `"`
	}
	cases := []struct {
		name, path, body string
		code             int
		want             string
	}{
		{"too long", "/team/2/skills", `{"skills":["` + strings.Repeat("ก", 41) + `"]}`, 422, "too_long"},
		{"too many", "/team/2/skills", `{"skills":[` + strings.Join(many, ",") + `]}`, 422, "too_many"},
		{"missing", "/team/2/skills", `{}`, 422, "required"},
		{"unknown user", "/team/99/skills", `{"skills":["Go"]}`, 404, ""},
		{"bad id", "/team/x/skills", `{"skills":["Go"]}`, 400, ""},
	}
	for _, c := range cases {
		code, body := e.call(1, "PUT", c.path, c.body)
		if code != c.code {
			t.Errorf("%s: code = %d %v, want %d", c.name, code, body, c.code)
			continue
		}
		if c.want != "" {
			fields, _ := body["fields"].(map[string]any)
			if fields["skills"] != c.want {
				t.Errorf("%s: fields = %v, want skills=%s", c.name, body, c.want)
			}
		}
	}
}

func TestTeam_WorkloadCountsOpenCardsInLiveProjects(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	d := func(s string) *store.Date { v := store.Date(s); return &v }
	done := now
	err := e.st.Update(ctx, func(r store.Repos) error {
		mk := func(archivedProject bool) (int64, error) {
			p, err := r.Projects.Create(ctx, store.Project{Name: "P", Status: "active", CreatedBy: 1})
			if err != nil {
				return 0, err
			}
			if archivedProject {
				p.ArchivedAt = &done
				if err := r.Projects.Save(ctx, p); err != nil {
					return 0, err
				}
			}
			b, err := r.Boards.Create(ctx, store.Board{ProjectID: p.ID})
			if err != nil {
				return 0, err
			}
			l, err := r.Lists.Create(ctx, store.List{BoardID: b.ID, Name: "L", Position: "a"})
			return l.ID, err
		}
		live, err := mk(false)
		if err != nil {
			return err
		}
		gone, err := mk(true)
		if err != nil {
			return err
		}
		add := func(list int64, due *store.Date, completed bool) error {
			c := store.Card{ListID: list, Title: "c", DueDate: due, Position: "a"}
			if completed {
				c.CompletedAt = &done
			}
			c, err := r.Cards.Create(ctx, c)
			if err != nil {
				return err
			}
			_, err = r.Cards.AddAssignee(ctx, c.ID, 4, now)
			return err
		}
		for _, x := range []struct {
			list      int64
			due       *store.Date
			completed bool
		}{
			{live, d("2026-11-17"), false}, // overdue (before Bangkok today)
			{live, d("2026-11-18"), false}, // due today: soon
			{live, d("2026-11-24"), false}, // soon (within 7 days)
			{live, d("2026-11-25"), false}, // later
			{live, nil, false},             // no date
			{live, d("2026-11-01"), true},  // completed: not counted
			{gone, d("2026-11-01"), false}, // archived project: not counted
		} {
			if err := add(x.list, x.due, x.completed); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, body := e.call(1, "GET", "/team", "")
	p := person(t, body, 4)
	if p["open"] != 5.0 || p["overdue"] != 1.0 || p["dueSoon"] != 2.0 {
		t.Fatalf("workload = open %v overdue %v dueSoon %v, want 5/1/2", p["open"], p["overdue"], p["dueSoon"])
	}
	if q := person(t, body, 1); q["open"] != 0.0 {
		t.Fatalf("user 1 open = %v", q["open"])
	}
}
