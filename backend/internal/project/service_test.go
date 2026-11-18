package project_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
	"tracking-service/internal/validate"
)

var t0 = time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)

const (
	admin   int64 = 1
	manager int64 = 2
	regular int64 = 3
	other   int64 = 4
)

type env struct {
	svc *project.Service
	st  *memory.Store
	ctx context.Context
}

func newEnv(t *testing.T) env {
	t.Helper()
	now := clock.Fixed(t0)
	st := memory.New(now)
	st.SeedUserRole(store.UserRole{UserID: admin, Role: "admin"})
	st.SeedUserRole(store.UserRole{UserID: manager, Role: "manager"})
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	slog.SetDefault(quiet) // the router logs every request through the default logger
	ev := events.NewLog(quiet)
	return env{project.New(st, users.NewStub(), ev, now), st, context.Background()}
}

func code(err error) string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func ptr[T any](v T) *T { return &v }

func (e env) mustCreate(t *testing.T, by int64, name string) project.ProjectView {
	t.Helper()
	p, err := e.svc.Create(e.ctx, by, project.CreateProjectInput{Name: name, Lang: "en"})
	if err != nil {
		t.Fatalf("create %q: %v", name, err)
	}
	return p
}

func (e env) listsOf(t *testing.T, projectID int64) []store.List {
	t.Helper()
	var out []store.List
	err := e.st.View(e.ctx, func(r store.Repos) error {
		b, err := r.Boards.ByProject(e.ctx, projectID)
		if err != nil {
			return err
		}
		out, err = r.Lists.ByBoard(e.ctx, b.ID)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCreate_RegularUserForbidden(t *testing.T) {
	e := newEnv(t)
	_, err := e.svc.Create(e.ctx, regular, project.CreateProjectInput{Name: "A", Lang: "en"})
	if code(err) != "forbidden" {
		t.Fatalf("err = %v", err)
	}
}

func TestCreate_ManagerCreatesBoardListsAndBecomesPM(t *testing.T) {
	e := newEnv(t)
	p, err := e.svc.Create(e.ctx, manager, project.CreateProjectInput{Name: "เว็บไซต์", Lang: "th"})
	if err != nil {
		t.Fatal(err)
	}
	if p.MyRole != "pm" || p.OwnerID != manager {
		t.Fatalf("view = %+v", p)
	}
	_ = e.st.View(e.ctx, func(r store.Repos) error {
		m, err := r.Members.Get(e.ctx, p.ID, manager)
		if err != nil || m.Role != "pm" {
			t.Errorf("creator member = %+v %v", m, err)
		}
		if u, _ := r.Users.Get(e.ctx, []int64{manager}); len(u) != 1 {
			t.Errorf("creator not cached")
		}
		return nil
	})
	lists := e.listsOf(t, p.ID)
	want := []string{"สิ่งที่ต้องทำ", "กำลังทำ", "รอตรวจ", "เสร็จแล้ว"}
	if len(lists) != 4 {
		t.Fatalf("lists = %d", len(lists))
	}
	for i, l := range lists {
		if l.Name != want[i] || l.IsDone != (i == 3) {
			t.Errorf("list %d = %+v", i, l)
		}
	}
	act := e.st.Activity()
	if len(act) != 1 || act[0].Type != "project.created" || act[0].ProjectID != p.ID || act[0].ActorID != manager {
		t.Fatalf("activity = %+v", act)
	}
}

func TestCreate_EnglishNames(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	lists := e.listsOf(t, p.ID)
	if lists[0].Name != "To Do" || lists[3].Name != "Done" {
		t.Fatalf("lists = %+v", lists)
	}
}

func TestCreate_DuplicateNameCaseInsensitiveConflict(t *testing.T) {
	e := newEnv(t)
	e.mustCreate(t, manager, "Website")
	_, err := e.svc.Create(e.ctx, manager, project.CreateProjectInput{Name: " website ", Lang: "en"})
	if code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestCreate_ArchivedNameCanBeReused(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "Website")
	if _, err := e.svc.Archive(e.ctx, manager, p.ID); err != nil {
		t.Fatal(err)
	}
	e.mustCreate(t, manager, "website")
	if _, err := e.svc.Restore(e.ctx, manager, p.ID); code(err) != "conflict" {
		t.Fatalf("restore err = %v", err)
	}
}

func TestCreate_Validation(t *testing.T) {
	e := newEnv(t)
	_, err := e.svc.Create(e.ctx, manager, project.CreateProjectInput{Name: "  ", Lang: "xx"})
	var ae *apperr.Error
	if !errors.As(err, &ae) || ae.Code != "validation_failed" || ae.Fields["name"] != "required" || ae.Fields["lang"] != "invalid" {
		t.Fatalf("err = %v", err)
	}
	_, err = e.svc.Create(e.ctx, manager, project.CreateProjectInput{Name: strings.Repeat("ก", 201), Lang: "th"})
	if !errors.As(err, &ae) || ae.Fields["name"] != "too_long" {
		t.Fatalf("err = %v", err)
	}
}

func TestList_RegularUserSeesOnlyMemberProjects(t *testing.T) {
	e := newEnv(t)
	mine := e.mustCreate(t, manager, "Mine")
	e.mustCreate(t, manager, "Hidden")
	if _, err := e.svc.AddMember(e.ctx, manager, mine.ID, regular, "viewer"); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.List(e.ctx, regular)
	if err != nil || len(got) != 1 || got[0].ID != mine.ID || got[0].MyRole != "viewer" {
		t.Fatalf("got %+v %v", got, err)
	}
}

func TestList_AdminSeesAll(t *testing.T) {
	e := newEnv(t)
	a := e.mustCreate(t, manager, "A")
	e.mustCreate(t, manager, "B")
	if _, err := e.svc.Archive(e.ctx, manager, a.ID); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.List(e.ctx, admin)
	if err != nil || len(got) != 2 {
		t.Fatalf("got %+v %v", got, err)
	}
	if got[0].ArchivedAt != nil || got[1].ArchivedAt == nil || got[0].MyRole != "admin" {
		t.Fatalf("order/role wrong: %+v", got)
	}
}

func TestGet_NonMemberIsNotFound(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	if _, err := e.svc.Get(e.ctx, regular, p.ID); code(err) != "not_found" {
		t.Fatalf("err = %v", err)
	}
	if _, err := e.svc.Get(e.ctx, admin, 999); code(err) != "not_found" {
		t.Fatalf("admin missing project err = %v", err)
	}
	if got, err := e.svc.Get(e.ctx, admin, p.ID); err != nil || got.MyRole != "admin" {
		t.Fatalf("admin get = %+v %v", got, err)
	}
}

func TestUpdate_MemberForbidden_PMAllowed(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, regular, "member"); err != nil {
		t.Fatal(err)
	}
	in := project.UpdateProjectInput{Name: ptr("B"), Status: ptr("on_hold")}
	if _, err := e.svc.Update(e.ctx, regular, p.ID, in); code(err) != "forbidden" {
		t.Fatalf("member err = %v", err)
	}
	got, err := e.svc.Update(e.ctx, manager, p.ID, in)
	if err != nil || got.Name != "B" || got.Status != "on_hold" {
		t.Fatalf("pm update = %+v %v", got, err)
	}
}

func TestUpdate_EndBeforeStartIsValidation(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	_, err := e.svc.Update(e.ctx, manager, p.ID, project.UpdateProjectInput{StartDate: validate.SetDate(ptr("2026-12-10")), EndDate: validate.SetDate(ptr("2026-12-01"))})
	var ae *apperr.Error
	if !errors.As(err, &ae) || ae.Code != "validation_failed" || ae.Fields["endDate"] != "before_start" {
		t.Fatalf("err = %v", err)
	}
	// Only the end given: still checked against the stored start.
	if _, err := e.svc.Update(e.ctx, manager, p.ID, project.UpdateProjectInput{StartDate: validate.SetDate(ptr("2026-12-10"))}); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Update(e.ctx, manager, p.ID, project.UpdateProjectInput{EndDate: validate.SetDate(ptr("2026-12-01"))})
	if !errors.As(err, &ae) || ae.Fields["endDate"] != "before_start" {
		t.Fatalf("stored-start err = %v", err)
	}
}

func TestUpdate_RenameClashConflict(t *testing.T) {
	e := newEnv(t)
	e.mustCreate(t, manager, "A")
	b := e.mustCreate(t, manager, "B")
	if _, err := e.svc.Update(e.ctx, manager, b.ID, project.UpdateProjectInput{Name: ptr("a")}); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestRemoveMember_LastPMConflict(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	if err := e.svc.RemoveMember(e.ctx, manager, p.ID, manager); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, regular, "pm"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RemoveMember(e.ctx, manager, p.ID, manager); err != nil {
		t.Fatalf("with second pm: %v", err)
	}
}

func TestSetRole_LastPMSelfDemoteConflict(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	if _, err := e.svc.SetRole(e.ctx, manager, p.ID, manager, "member"); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
	if _, err := e.svc.SetRole(e.ctx, manager, p.ID, manager, "pm"); err != nil {
		t.Fatalf("pm to pm: %v", err)
	}
}

func TestLastPM_AdminNonMemberNotCounted(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	// The admin is not a member, so acting as admin does not make the only PM removable.
	if err := e.svc.RemoveMember(e.ctx, admin, p.ID, manager); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestAddMember_UpsertsUserCacheAndTouchesBoard(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "A")
	m, err := e.svc.AddMember(e.ctx, manager, p.ID, other, "member")
	if err != nil || m.UserID != other || m.Role != "member" || m.Name == "" {
		t.Fatalf("member = %+v %v", m, err)
	}
	_ = e.st.View(e.ctx, func(r store.Repos) error {
		got, _ := r.Users.Get(e.ctx, []int64{other})
		if len(got) != 1 || got[0].DisplayName != "Somsak P." {
			t.Errorf("cache = %+v", got)
		}
		b, _ := r.Boards.ByProject(e.ctx, p.ID)
		if !b.UpdatedAt.Equal(t0) {
			t.Errorf("board not touched: %v", b.UpdatedAt)
		}
		return nil
	})
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, other, "member"); code(err) != "conflict" {
		t.Fatalf("duplicate add err = %v", err)
	}
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, 99, "member"); code(err) != "not_found" {
		t.Fatalf("unknown user err = %v", err)
	}
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, 5, "boss"); code(err) != "validation_failed" {
		t.Fatalf("bad role err = %v", err)
	}
	if _, err := e.svc.AddMember(e.ctx, other, p.ID, 5, "member"); code(err) != "forbidden" {
		t.Fatalf("member add err = %v", err)
	}
	act := e.st.Activity()
	if got := act[len(act)-1].Type; got != "member.added" {
		t.Fatalf("last activity = %q", got)
	}
}

func TestMe_UpsertsCacheAndReportsCapabilities(t *testing.T) {
	e := newEnv(t)
	me, err := e.svc.Me(e.ctx, admin)
	if err != nil || !me.IsAdmin || !me.CanCreateProject || me.User.ID != admin || me.User.Name == "" {
		t.Fatalf("me = %+v %v", me, err)
	}
	me, _ = e.svc.Me(e.ctx, regular)
	if me.IsAdmin || me.CanCreateProject {
		t.Fatalf("regular = %+v", me)
	}
	_ = e.st.View(e.ctx, func(r store.Repos) error {
		if got, _ := r.Users.Get(e.ctx, []int64{admin}); len(got) != 1 {
			t.Errorf("cache = %+v", got)
		}
		return nil
	})
}

func TestSearchUsers_ClampsAndRequiresQuery(t *testing.T) {
	e := newEnv(t)
	if got, err := e.svc.SearchUsers(e.ctx, "  "); err != nil || len(got) != 0 {
		t.Fatalf("empty q = %+v %v", got, err)
	}
	got, err := e.svc.SearchUsers(e.ctx, "napat")
	if err != nil || len(got) != 1 || got[0].ID != 2 {
		t.Fatalf("got %+v %v", got, err)
	}
}

func TestRefreshUserCache_UpdatesOnlyStaleRows(t *testing.T) {
	e := newEnv(t)
	_ = e.st.Update(e.ctx, func(r store.Repos) error {
		return r.Users.Upsert(e.ctx, []store.CachedUser{
			{UserID: 1, DisplayName: "old1", SyncedAt: t0.Add(-48 * time.Hour)},
			{UserID: 2, DisplayName: "fresh2", SyncedAt: t0.Add(-time.Hour)},
		})
	})
	n, err := e.svc.RefreshUserCache(e.ctx, 24*time.Hour)
	if err != nil || n != 1 {
		t.Fatalf("n = %d, %v", n, err)
	}
	_ = e.st.View(e.ctx, func(r store.Repos) error {
		got, _ := r.Users.Get(e.ctx, []int64{1, 2})
		if got[0].DisplayName != "สมชาย ใจดี" || !got[0].SyncedAt.Equal(t0) {
			t.Errorf("stale row not refreshed: %+v", got[0])
		}
		if got[1].DisplayName != "fresh2" {
			t.Errorf("fresh row touched: %+v", got[1])
		}
		return nil
	})
}
