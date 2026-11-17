package card_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
)

var t0 = time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)

const (
	admin   int64 = 1
	manager int64 = 2 // creates the projects, so is their PM
	member  int64 = 3
	viewer  int64 = 4
	outside int64 = 5
)

type env struct {
	svc   *card.Service
	proj  *project.Service
	board *board.Service
	st    *memory.Store
	ctx   context.Context
	pid   int64
	tick  *int
}

func newEnv(t *testing.T) env {
	t.Helper()
	tick := new(int)
	now := clock.Clock(func() time.Time { return t0.Add(time.Duration(*tick) * time.Minute) })
	st := memory.New(now)
	st.SeedUserRole(store.UserRole{UserID: admin, Role: "admin"})
	st.SeedUserRole(store.UserRole{UserID: manager, Role: "manager"})
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	slog.SetDefault(quiet)
	ev := events.NewLog(quiet)
	up := users.NewStub()
	e := env{
		svc: card.New(st, up, ev, now), proj: project.New(st, up, ev, now), board: board.New(st, ev, now),
		st: st, ctx: context.Background(), tick: tick,
	}
	e.pid = e.newProject(t, "P")
	return e
}

func (e env) newProject(t *testing.T, name string) int64 {
	t.Helper()
	p, err := e.proj.Create(e.ctx, manager, project.CreateProjectInput{Name: name, Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	for uid, role := range map[int64]string{member: "member", viewer: "viewer"} {
		if _, err := e.proj.AddMember(e.ctx, manager, p.ID, uid, role); err != nil {
			t.Fatal(err)
		}
	}
	return p.ID
}

func code(err error) string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func fieldsOf(err error) map[string]string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Fields
	}
	return nil
}

func ptr[T any](v T) *T { return &v }

func (e env) listsOf(t *testing.T, pid int64) []store.List {
	t.Helper()
	var out []store.List
	if err := e.st.View(e.ctx, func(r store.Repos) error {
		b, err := r.Boards.ByProject(e.ctx, pid)
		if err != nil {
			return err
		}
		out, err = r.Lists.ByBoard(e.ctx, b.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return out
}

// lists returns the default lists; the last one is the Done list.
func (e env) lists(t *testing.T) []store.List { return e.listsOf(t, e.pid) }

func (e env) update(t *testing.T, fn func(store.Repos) error) {
	t.Helper()
	if err := e.st.Update(e.ctx, fn); err != nil {
		t.Fatal(err)
	}
}

func (e env) mk(t *testing.T, listID int64, title string) card.CardDetail {
	t.Helper()
	c, err := e.svc.Create(e.ctx, member, listID, card.CreateCardInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (e env) boardUpdatedAt(t *testing.T) time.Time {
	t.Helper()
	var at time.Time
	e.update(t, func(r store.Repos) error {
		b, err := r.Boards.ByProject(e.ctx, e.pid)
		at = b.UpdatedAt
		return err
	})
	return at
}

func (e env) order(t *testing.T, listID int64) []int64 {
	t.Helper()
	var ids []int64
	e.update(t, func(r store.Repos) error {
		ps, err := r.Cards.Positions(e.ctx, listID)
		for _, p := range ps {
			if !p.Archived {
				ids = append(ids, p.ID)
			}
		}
		return err
	})
	return ids
}

func TestCreate_ViewerForbidden(t *testing.T) {
	e := newEnv(t)
	_, err := e.svc.Create(e.ctx, viewer, e.lists(t)[0].ID, card.CreateCardInput{Title: "x"})
	if code(err) != "forbidden" {
		t.Fatalf("err = %v", err)
	}
	if _, err := e.svc.Create(e.ctx, outside, e.lists(t)[0].ID, card.CreateCardInput{Title: "x"}); code(err) != "not_found" {
		t.Fatalf("outsider err = %v", err)
	}
}

func TestCreate_AppendsAtEnd(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	a, b := e.mk(t, l, "a"), e.mk(t, l, "b")
	if a.Position >= b.Position {
		t.Fatalf("positions %q %q", a.Position, b.Position)
	}
	if got := e.order(t, l); len(got) != 2 || got[0] != a.ID || got[1] != b.ID {
		t.Fatalf("order = %v", got)
	}
}

func TestCreate_InArchivedListConflict(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	if _, err := e.board.ArchiveList(e.ctx, manager, l); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Create(e.ctx, member, l, card.CreateCardInput{Title: "x"}); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestCreate_InDoneListSetsCompletedAt(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	c := e.mk(t, ls[len(ls)-1].ID, "done already")
	if c.CompletedAt == nil || !c.CompletedAt.Equal(t0) {
		t.Fatalf("completedAt = %v", c.CompletedAt)
	}
	if e.mk(t, ls[0].ID, "todo").CompletedAt != nil {
		t.Fatal("non-done list must not stamp completedAt")
	}
}

func TestCreate_Title200ThaiRunesOK_201TooLong(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	ok := strings.Repeat("ก", 200) // 600 bytes
	if _, err := e.svc.Create(e.ctx, member, l, card.CreateCardInput{Title: ok}); err != nil {
		t.Fatalf("200 runes: %v", err)
	}
	_, err := e.svc.Create(e.ctx, member, l, card.CreateCardInput{Title: ok + "ก"})
	if code(err) != "validation_failed" || fieldsOf(err)["title"] != "too_long" {
		t.Fatalf("201 runes: %v %v", err, fieldsOf(err))
	}
	_, err = e.svc.Create(e.ctx, member, l, card.CreateCardInput{Title: "  "})
	if fieldsOf(err)["title"] != "required" {
		t.Fatalf("blank: %v", fieldsOf(err))
	}
}

func TestUpdate_PriorityNamesRoundTrip(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	for _, p := range []string{"low", "medium", "high", "urgent"} {
		got, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Priority: ptr(p)})
		if err != nil || got.Priority != p {
			t.Fatalf("%s: %v %q", p, err, got.Priority)
		}
		if g, _ := e.svc.Get(e.ctx, member, c.ID); g.Priority != p {
			t.Fatalf("get %s = %q", p, g.Priority)
		}
	}
}

func TestUpdate_BadPriorityValidation(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	_, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Priority: ptr("critical")})
	if code(err) != "validation_failed" || fieldsOf(err)["priority"] != "invalid" {
		t.Fatalf("err = %v %v", err, fieldsOf(err))
	}
}

func TestUpdate_NullClearsDueDate(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	got, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{DueDate: card.SetDate(ptr("2026-12-01"))})
	if err != nil || got.DueDate == nil || *got.DueDate != "2026-12-01" {
		t.Fatalf("set: %v %v", err, got.DueDate)
	}
	// absent field leaves it alone
	if got, _ = e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Title: ptr("renamed")}); got.DueDate == nil {
		t.Fatal("absent dueDate was cleared")
	}
	got, err = e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{DueDate: card.SetDate(nil)})
	if err != nil || got.DueDate != nil {
		t.Fatalf("clear: %v %v", err, got.DueDate)
	}
}

func TestUpdate_DueBeforeStartValidation(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	_, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{
		StartDate: card.SetDate(ptr("2026-12-10")), DueDate: card.SetDate(ptr("2026-12-01"))})
	if fieldsOf(err)["dueDate"] != "before_start" {
		t.Fatalf("err = %v %v", err, fieldsOf(err))
	}
	// order is checked against the stored start when only due is sent
	if _, err = e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{StartDate: card.SetDate(ptr("2026-12-10"))}); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{DueDate: card.SetDate(ptr("2026-12-01"))})
	if fieldsOf(err)["dueDate"] != "before_start" {
		t.Fatalf("stored start: %v", err)
	}
	_, err = e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{DueDate: card.SetDate(ptr("nope"))})
	if fieldsOf(err)["dueDate"] != "invalid_date" {
		t.Fatalf("bad date: %v", err)
	}
}

func TestUpdate_ArchivedCardConflict_ViewerForbidden(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	if _, err := e.svc.Update(e.ctx, viewer, c.ID, card.UpdateCardInput{Title: ptr("x")}); code(err) != "forbidden" {
		t.Fatalf("viewer: %v", err)
	}
	if _, err := e.svc.Archive(e.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Title: ptr("x")}); code(err) != "conflict" {
		t.Fatalf("archived: %v", err)
	}
}

func TestMove_IntoDoneSetsCompletedAt_OutClears_WithinKeeps(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	todo, done := ls[0].ID, ls[len(ls)-1].ID
	c := e.mk(t, todo, "c")
	*e.tick = 5
	got, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: done})
	if err != nil || got.ListID != done || got.CompletedAt == nil || !got.CompletedAt.Equal(t0.Add(5*time.Minute)) {
		t.Fatalf("into done: %v %+v", err, got)
	}
	first := *got.CompletedAt
	*e.tick = 9
	other := e.mk(t, done, "other")
	got, err = e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: done, AfterID: &other.ID})
	if err != nil || got.CompletedAt == nil || !got.CompletedAt.Equal(first) {
		t.Fatalf("within done: %v %v", err, got.CompletedAt)
	}
	got, err = e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: todo})
	if err != nil || got.CompletedAt != nil || got.ListID != todo {
		t.Fatalf("out of done: %v %+v", err, got)
	}
}

func TestMove_BetweenNeighboursAndOtherList(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	a, b, c := e.mk(t, ls[0].ID, "a"), e.mk(t, ls[0].ID, "b"), e.mk(t, ls[0].ID, "c")
	if _, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: ls[0].ID, BeforeID: &a.ID, AfterID: &b.ID}); err != nil {
		t.Fatal(err)
	}
	if got := e.order(t, ls[0].ID); got[0] != a.ID || got[1] != c.ID || got[2] != b.ID {
		t.Fatalf("order = %v", got)
	}
	x := e.mk(t, ls[1].ID, "x")
	if _, err := e.svc.Move(e.ctx, member, a.ID, card.MoveCardInput{ToListID: ls[1].ID, BeforeID: &x.ID}); err != nil {
		t.Fatal(err)
	}
	if got := e.order(t, ls[1].ID); len(got) != 2 || got[0] != x.ID || got[1] != a.ID {
		t.Fatalf("target order = %v", got)
	}
	if got := e.order(t, ls[0].ID); len(got) != 2 {
		t.Fatalf("source order = %v", got)
	}
}

func TestMove_IntoArchivedListConflict(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	c := e.mk(t, ls[0].ID, "c")
	if _, err := e.board.ArchiveList(e.ctx, manager, ls[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: ls[1].ID}); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestMove_StaleNeighboursConflict(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	a, b := e.mk(t, ls[0].ID, "a"), e.mk(t, ls[0].ID, "b")
	elsewhere := e.mk(t, ls[1].ID, "elsewhere")
	mv := e.mk(t, ls[0].ID, "mv")
	before := e.order(t, ls[0].ID)

	for name, in := range map[string]card.MoveCardInput{
		"neighbour in another list": {ToListID: ls[0].ID, BeforeID: &elsewhere.ID},
		"after in another list":     {ToListID: ls[0].ID, AfterID: &elsewhere.ID},
		"reversed":                  {ToListID: ls[0].ID, BeforeID: &b.ID, AfterID: &a.ID},
		"missing":                   {ToListID: ls[0].ID, BeforeID: ptr(int64(9999))},
	} {
		_, err := e.svc.Move(e.ctx, member, mv.ID, in)
		if code(err) != "conflict" {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	after := e.order(t, ls[0].ID)
	if len(before) != len(after) {
		t.Fatalf("order changed %v -> %v", before, after)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Fatalf("order changed %v -> %v", before, after)
		}
	}
}

func TestMove_CrossProjectListNotFound(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	other := e.listsOf(t, e.newProject(t, "Other"))[0].ID
	_, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: other})
	if code(err) != "not_found" || !strings.Contains(err.Error(), "list") {
		t.Fatalf("err = %v", err)
	}
}

func TestMove_RebalancesOnNoGap(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	tight := "a" + strings.Repeat("0", 60) + "1"
	var a, b, c store.Card
	e.update(t, func(r store.Repos) error {
		mk := func(title, pos string) store.Card {
			x, _ := r.Cards.Create(e.ctx, store.Card{ListID: l, Title: title, Position: pos, CreatedAt: t0, UpdatedAt: t0})
			return x
		}
		a, b, c = mk("a", "a"), mk("b", tight), mk("c", "z")
		return nil
	})
	if _, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: l, BeforeID: &a.ID, AfterID: &b.ID}); err != nil {
		t.Fatal(err)
	}
	if got := e.order(t, l); len(got) != 3 || got[0] != a.ID || got[1] != c.ID || got[2] != b.ID {
		t.Fatalf("order = %v", got)
	}
}

func TestMove_BumpsBoardUpdatedAt(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	c := e.mk(t, ls[0].ID, "c")
	*e.tick = 30
	if _, err := e.svc.Move(e.ctx, member, c.ID, card.MoveCardInput{ToListID: ls[1].ID}); err != nil {
		t.Fatal(err)
	}
	if got := e.boardUpdatedAt(t); !got.Equal(t0.Add(30 * time.Minute)) {
		t.Fatalf("board updated_at = %v", got)
	}
	evs := e.st.Activity()
	last := evs[len(evs)-1]
	if last.Type != "card.moved" || last.CardID == nil || *last.CardID != c.ID {
		t.Fatalf("event = %+v", last)
	}
}

func TestAssign_NonMemberValidation(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	_, err := e.svc.Assign(e.ctx, member, c.ID, outside)
	if code(err) != "validation_failed" || fieldsOf(err)["userId"] != "not_member" {
		t.Fatalf("err = %v %v", err, fieldsOf(err))
	}
	if _, err := e.svc.Assign(e.ctx, viewer, c.ID, member); code(err) != "forbidden" {
		t.Fatalf("viewer: %v", err)
	}
}

func TestAssign_Idempotent(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	got, err := e.svc.Assign(e.ctx, member, c.ID, member)
	if err != nil || len(got.AssigneeIDs) != 1 || got.AssigneeIDs[0] != member {
		t.Fatalf("first: %v %+v", err, got)
	}
	n := len(e.st.Activity())
	*e.tick = 10
	got, err = e.svc.Assign(e.ctx, member, c.ID, member)
	if err != nil || len(got.AssigneeIDs) != 1 {
		t.Fatalf("second: %v %+v", err, got)
	}
	if len(e.st.Activity()) != n {
		t.Fatal("second assign logged an event")
	}
	got, err = e.svc.Unassign(e.ctx, member, c.ID, member)
	if err != nil || len(got.AssigneeIDs) != 0 {
		t.Fatalf("unassign: %v %+v", err, got)
	}
	if _, err = e.svc.Unassign(e.ctx, member, c.ID, member); err != nil {
		t.Fatalf("unassign twice: %v", err)
	}
}

func TestArchiveRestore_AppendsAndKeepsDoneConsistent(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	l := ls[0].ID
	a, b := e.mk(t, l, "a"), e.mk(t, l, "b")
	got, err := e.svc.Archive(e.ctx, member, a.ID)
	if err != nil || got.ArchivedAt == nil {
		t.Fatalf("archive: %v %+v", err, got)
	}
	got, err = e.svc.Restore(e.ctx, member, a.ID)
	if err != nil || got.ArchivedAt != nil {
		t.Fatalf("restore: %v %+v", err, got)
	}
	if o := e.order(t, l); len(o) != 2 || o[0] != b.ID || o[1] != a.ID {
		t.Fatalf("order = %v", o)
	}
	// list became Done while the card was archived: restore stamps completedAt
	d := e.mk(t, ls[1].ID, "d")
	if _, err := e.svc.Archive(e.ctx, member, d.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.board.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{IsDone: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if got, err = e.svc.Restore(e.ctx, member, d.ID); err != nil || got.CompletedAt == nil {
		t.Fatalf("restore into done: %v %+v", err, got)
	}
}

func TestRestore_ListArchivedConflict(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	c := e.mk(t, l, "c")
	if _, err := e.svc.Archive(e.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.board.ArchiveList(e.ctx, manager, l); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Restore(e.ctx, member, c.ID); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestGet_NonMemberNotFound_ViewerReads(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	if _, err := e.svc.Get(e.ctx, outside, c.ID); code(err) != "not_found" {
		t.Fatalf("outsider: %v", err)
	}
	if _, err := e.svc.Get(e.ctx, viewer, c.ID); err != nil {
		t.Fatalf("viewer: %v", err)
	}
	if _, err := e.svc.Get(e.ctx, outside, 9999); code(err) != "not_found" {
		t.Fatalf("missing: %v", err)
	}
}
