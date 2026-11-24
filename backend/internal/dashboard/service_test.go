package dashboard_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/clock"
	"tracking-service/internal/dashboard"
	"tracking-service/internal/httpx"
	"tracking-service/internal/store"
	"tracking-service/internal/store/storetest"
)

const (
	adminID  int64 = 1
	userA    int64 = 2
	userB    int64 = 3
	outsider int64 = 4
)

// 2026-11-17 18:30 UTC is 2026-11-18 01:30 in Bangkok: today must be the 18th.
var nearMidnightUTC = time.Date(2026, 11, 17, 18, 30, 0, 0, time.UTC)

type fixture struct {
	st            storetest.Store
	svc           *dashboard.Service
	pAlpha, pBeta int64
	pArchived     int64
	ctx           context.Context
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	now := clock.Fixed(nearMidnightUTC)
	st := storetest.New(t, now)
	st.SeedUserRole(store.UserRole{UserID: adminID, Role: "admin"})
	f := fixture{st: st, svc: dashboard.New(st, now), ctx: context.Background()}
	err := st.Update(f.ctx, func(r store.Repos) error {
		if err := r.Users.Upsert(f.ctx, []store.CachedUser{
			{UserID: userA, DisplayName: "Ann", AvatarURL: "a.png"},
			{UserID: userB, DisplayName: "Ben"},
		}); err != nil {
			return err
		}
		mk := func(name string, archived bool, members ...int64) (int64, error) {
			p := store.Project{Name: name, Status: "active", OwnerID: userA}
			if archived {
				p.ArchivedAt = &nearMidnightUTC
			}
			p, err := r.Projects.Create(f.ctx, p)
			if err != nil {
				return 0, err
			}
			for _, u := range members {
				if err := r.Members.Put(f.ctx, store.Member{ProjectID: p.ID, UserID: u, Role: "member"}); err != nil {
					return 0, err
				}
			}
			b, err := r.Boards.Create(f.ctx, store.Board{ProjectID: p.ID})
			if err != nil {
				return 0, err
			}
			active, err := r.Lists.Create(f.ctx, store.List{BoardID: b.ID, Name: "Doing"})
			if err != nil {
				return 0, err
			}
			gone, err := r.Lists.Create(f.ctx, store.List{BoardID: b.ID, Name: "Old", ArchivedAt: &nearMidnightUTC})
			if err != nil {
				return 0, err
			}
			due := store.Date("2026-11-17") // overdue only if today is the 18th
			c1, err := r.Cards.Create(f.ctx, store.Card{ListID: active.ID, Title: name + " overdue", DueDate: &due})
			if err != nil {
				return 0, err
			}
			if _, err := r.Cards.AddAssignee(f.ctx, c1.ID, userA, nearMidnightUTC); err != nil {
				return 0, err
			}
			if _, err := r.Cards.Create(f.ctx, store.Card{ListID: active.ID, Title: name + " archived", ArchivedAt: &nearMidnightUTC}); err != nil {
				return 0, err
			}
			if _, err := r.Cards.Create(f.ctx, store.Card{ListID: gone.ID, Title: name + " in archived list"}); err != nil {
				return 0, err
			}
			return p.ID, nil
		}
		var err error
		if f.pAlpha, err = mk("Alpha", false, userA); err != nil {
			return err
		}
		if f.pBeta, err = mk("Beta", false, userB); err != nil {
			return err
		}
		f.pArchived, err = mk("Old project", true, userA)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func code(err error) string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func TestService_TodayIsBangkokDate(t *testing.T) {
	f := newFixture(t)
	v, err := f.svc.Get(f.ctx, userA, nil)
	if err != nil {
		t.Fatal(err)
	}
	if v.AsOf != "2026-11-18" {
		t.Fatalf("asOf = %q, want the Bangkok date 2026-11-18", v.AsOf)
	}
	if v.Totals.Overdue != 1 {
		t.Fatalf("overdue = %d: a card due 11-17 is overdue on Bangkok 11-18", v.Totals.Overdue)
	}
}

func TestService_MemberSeesOnlyOwnProjects(t *testing.T) {
	f := newFixture(t)
	v, err := f.svc.Get(f.ctx, userA, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.ByProject) != 1 || v.ByProject[0].Name != "Alpha" || v.Totals.Total != 1 {
		t.Fatalf("byProject = %+v totals = %+v", v.ByProject, v.Totals)
	}
	if len(v.Workload) != 1 || v.Workload[0].User.Name != "Ann" || v.Workload[0].Overdue != 1 {
		t.Fatalf("workload = %+v", v.Workload)
	}
}

func TestService_AdminSeesAllNonArchivedProjects(t *testing.T) {
	f := newFixture(t)
	v, err := f.svc.Get(f.ctx, adminID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.ByProject) != 2 || v.Totals.Total != 2 {
		t.Fatalf("byProject = %+v", v.ByProject)
	}
}

func TestService_ProjectScope(t *testing.T) {
	f := newFixture(t)
	v, err := f.svc.Get(f.ctx, userA, &f.pAlpha)
	if err != nil || len(v.ByProject) != 1 {
		t.Fatalf("member scope: %v %+v", err, v.ByProject)
	}
	if _, err := f.svc.Get(f.ctx, userA, &f.pBeta); code(err) != "not_found" {
		t.Fatalf("non-member = %v, want not_found", err)
	}
	if _, err := f.svc.Get(f.ctx, outsider, &f.pAlpha); code(err) != "not_found" {
		t.Fatalf("outsider = %v, want not_found", err)
	}
	if v, err = f.svc.Get(f.ctx, adminID, &f.pBeta); err != nil || len(v.ByProject) != 1 || v.ByProject[0].Name != "Beta" {
		t.Fatalf("admin scope: %v %+v", err, v.ByProject)
	}
	missing := int64(999)
	if _, err := f.svc.Get(f.ctx, adminID, &missing); code(err) != "not_found" {
		t.Fatalf("missing = %v", err)
	}
	if _, err := f.svc.Get(f.ctx, adminID, &f.pArchived); code(err) != "not_found" {
		t.Fatalf("archived = %v", err)
	}
	if _, err := f.svc.Get(f.ctx, userA, &f.pArchived); code(err) != "not_found" {
		t.Fatalf("archived member = %v", err)
	}
}

func TestService_UserWithNoProjectsGetsEmptyArrays(t *testing.T) {
	f := newFixture(t)
	v, err := f.svc.Get(f.ctx, outsider, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"byProject", "workload", "byPriority", "deadlines"} {
		if _, ok := m[k].([]any); !ok {
			t.Errorf("%s = %v, want array", k, m[k])
		}
	}
}

type headerAuth struct{}

func (headerAuth) Authenticate(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.Header.Get("X-User-ID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("no user")
	}
	return id, nil
}

func get(f fixture, user int64, query string) (*httptest.ResponseRecorder, map[string]any) {
	return getPath(f, user, "/dashboard"+query)
}

func getPath(f fixture, user int64, path string) (*httptest.ResponseRecorder, map[string]any) {
	h := httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(headerAuth{}))
		dashboard.Mount(r, f.svc)
	})
	req := httptest.NewRequest("GET", "/api/tracking/v1"+path, nil)
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestHandler_Shape(t *testing.T) {
	f := newFixture(t)
	rec, body := get(f, userA, "")
	if rec.Code != 200 || body["success"] != true {
		t.Fatalf("get = %d %s", rec.Code, rec.Body)
	}
	data := body["data"].(map[string]any)
	for _, k := range []string{"asOf", "totals", "byProject", "workload", "byPriority", "deadlines"} {
		if _, ok := data[k]; !ok {
			t.Errorf("missing %q", k)
		}
	}
	for _, k := range []string{"total", "done", "open", "inProgress", "notStarted", "overdue", "dueSoon", "unassigned"} {
		if _, ok := data["totals"].(map[string]any)[k]; !ok {
			t.Errorf("missing totals.%q", k)
		}
	}
	dl := data["deadlines"].([]any)[0].(map[string]any)
	for _, k := range []string{"cardId", "projectId", "projectName", "listName", "title", "dueDate", "daysLeft", "assignees"} {
		if _, ok := dl[k]; !ok {
			t.Errorf("missing deadline.%q", k)
		}
	}
	w := data["workload"].([]any)[0].(map[string]any)
	if _, ok := w["user"].(map[string]any)["avatarUrl"]; !ok {
		t.Errorf("workload user = %v", w["user"])
	}
}

func TestHandler_ProjectIDParam(t *testing.T) {
	f := newFixture(t)
	if rec, _ := get(f, userA, "?projectId="+strconv.FormatInt(f.pAlpha, 10)); rec.Code != 200 {
		t.Fatalf("member = %d", rec.Code)
	}
	rec, body := get(f, userA, "?projectId="+strconv.FormatInt(f.pBeta, 10))
	if rec.Code != 404 || body["code"] != "not_found" {
		t.Fatalf("non-member = %d %s", rec.Code, rec.Body)
	}
	for _, q := range []string{"?projectId=abc", "?projectId=0", "?projectId=-1"} {
		if rec, _ := get(f, userA, q); rec.Code != 400 {
			t.Errorf("%s = %d, want 400", q, rec.Code)
		}
	}
}
