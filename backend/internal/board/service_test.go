package board_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/board"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/store/storetest"
	"tracking-service/internal/users"
)

var t0 = time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)

const (
	admin   int64 = 1
	manager int64 = 2 // creates the project, so is its PM
	member  int64 = 3
	member2 int64 = 4 // a second member
	outside int64 = 5
)

type env struct {
	svc  *board.Service
	proj *project.Service
	st   storetest.Store
	ctx  context.Context
	pid  int64
	tick *int // minutes added to t0; the clock moves only when a test says so
}

func newEnv(t *testing.T) env {
	t.Helper()
	tick := new(int)
	now := clock.Clock(func() time.Time { return t0.Add(time.Duration(*tick) * time.Minute) })
	st := storetest.New(t, now)
	st.SeedUserRole(store.UserRole{UserID: admin, Role: "admin"})
	st.SeedUserRole(store.UserRole{UserID: manager, Role: "manager"})
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	slog.SetDefault(quiet)
	ev := events.NewLog(quiet)
	e := env{
		svc: board.New(st, ev, now), proj: project.New(st, users.NewStub(), ev, now),
		st: st, ctx: context.Background(), tick: tick,
	}
	p, err := e.proj.Create(e.ctx, manager, project.CreateProjectInput{Name: "P", Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	e.pid = p.ID
	for uid, role := range map[int64]string{member: "member", member2: "member"} {
		if _, err := e.proj.AddMember(e.ctx, manager, p.ID, uid, role); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func code(err error) string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func msg(err error) string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Msg
	}
	return ""
}

func ptr[T any](v T) *T { return &v }

func (e env) boardID(t *testing.T) int64 {
	t.Helper()
	var id int64
	if err := e.st.View(e.ctx, func(r store.Repos) error {
		b, err := r.Boards.ByProject(e.ctx, e.pid)
		id = b.ID
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e env) lists(t *testing.T) []store.List {
	t.Helper()
	bid := e.boardID(t)
	var out []store.List
	if err := e.st.View(e.ctx, func(r store.Repos) error {
		var err error
		out, err = r.Lists.ByBoard(e.ctx, bid)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return out
}

func (e env) update(t *testing.T, fn func(store.Repos) error) {
	t.Helper()
	if err := e.st.Update(e.ctx, fn); err != nil {
		t.Fatal(err)
	}
}

func (e env) card(t *testing.T, listID int64, title, pos string) store.Card {
	t.Helper()
	var c store.Card
	e.update(t, func(r store.Repos) error {
		var err error
		c, err = r.Cards.Create(e.ctx, store.Card{
			ListID: listID, Title: title, Description: "secret body", Priority: 2, Position: pos,
			CreatedBy: manager, CreatedAt: t0, UpdatedAt: t0,
		})
		return err
	})
	return c
}

func (e env) getCard(t *testing.T, id int64) store.Card {
	t.Helper()
	var c store.Card
	e.update(t, func(r store.Repos) error {
		var err error
		c, err = r.Cards.Get(e.ctx, id)
		return err
	})
	return c
}

func TestBoard_ExcludesArchivedAndSortsByPosition(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t) // 4 lists, ascending
	archivedList := ls[1].ID
	c1 := e.card(t, ls[0].ID, "second", "m")
	c2 := e.card(t, ls[0].ID, "first", "d")
	e.card(t, archivedList, "in archived list", "a")
	e.update(t, func(r store.Repos) error {
		_, err := r.Cards.Create(e.ctx, store.Card{ListID: ls[0].ID, Title: "gone", Position: "x", ArchivedAt: ptr(t0)})
		return err
	})
	if _, err := e.svc.ArchiveList(e.ctx, manager, archivedList); err != nil {
		t.Fatal(err)
	}

	v, role, err := e.svc.Board(e.ctx, member, e.pid)
	if err != nil {
		t.Fatal(err)
	}
	if role != "member" || v.MyRole != "member" {
		t.Fatalf("role = %q / %q", role, v.MyRole)
	}
	if len(v.Lists) != 3 {
		t.Fatalf("lists = %d, want 3 (archived excluded)", len(v.Lists))
	}
	for i := 1; i < len(v.Lists); i++ {
		if v.Lists[i-1].Position >= v.Lists[i].Position {
			t.Fatalf("lists not ascending: %+v", v.Lists)
		}
	}
	if len(v.Cards) != 2 || v.Cards[0].ID != c2.ID || v.Cards[1].ID != c1.ID {
		t.Fatalf("cards = %+v, want [%d %d] by position (archived and orphaned excluded)", v.Cards, c2.ID, c1.ID)
	}
	if len(v.Members) != 3 || len(v.Users) < 3 || v.Project.Name != "P" || v.Board.ID != e.boardID(t) {
		t.Fatalf("snapshot = %+v", v)
	}
}

func TestBoard_NoDescriptionInSummary(t *testing.T) {
	e := newEnv(t)
	e.card(t, e.lists(t)[0].ID, "card", "m")
	v, _, err := e.svc.Board(e.ctx, member2, e.pid)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(v)
	s := string(b)
	for _, bad := range []string{"descriptionMd", "description_md", "secret body"} {
		if strings.Contains(s, bad) {
			t.Errorf("board JSON leaks %q: %s", bad, s)
		}
	}
	for _, key := range []string{`"board"`, `"project"`, `"myRole"`, `"lists"`, `"cards"`, `"labels"`, `"members"`, `"users"`,
		`"priority":"high"`, `"assigneeIds":[]`, `"labelIds":[]`, `"checklistTotal":0`, `"commentCount":0`} {
		if !strings.Contains(s, key) {
			t.Errorf("board JSON lacks %s: %s", key, s)
		}
	}
}

func TestBoard_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	if _, _, err := e.svc.Board(e.ctx, outside, e.pid); code(err) != "not_found" {
		t.Fatalf("board err = %v", err)
	}
	if _, err := e.svc.Archived(e.ctx, outside, e.pid); code(err) != "not_found" {
		t.Fatalf("archived err = %v", err)
	}
}

func TestArchived_ListsAndCards(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	e.card(t, ls[0].ID, "live", "m")
	e.update(t, func(r store.Repos) error {
		_, err := r.Cards.Create(e.ctx, store.Card{ListID: ls[0].ID, Title: "old", Position: "n", ArchivedAt: ptr(t0)})
		return err
	})
	if _, err := e.svc.ArchiveList(e.ctx, manager, ls[3].ID); err != nil {
		t.Fatal(err)
	}
	a, err := e.svc.Archived(e.ctx, member2, e.pid)
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Lists) != 1 || a.Lists[0].ID != ls[3].ID || len(a.Cards) != 1 || a.Cards[0].Title != "old" {
		t.Fatalf("archived = %+v", a)
	}
}

func TestCreateList_AppendsAndValidates(t *testing.T) {
	e := newEnv(t)
	if _, err := e.svc.CreateList(e.ctx, outside, e.pid, "X"); code(err) != "not_found" {
		t.Fatalf("outsider err = %v", err)
	}
	if _, err := e.svc.CreateList(e.ctx, manager, e.pid, "  "); code(err) != "validation_failed" {
		t.Fatalf("empty name err = %v", err)
	}
	l, err := e.svc.CreateList(e.ctx, manager, e.pid, " Backlog ")
	if err != nil {
		t.Fatal(err)
	}
	ls := e.lists(t)
	if len(ls) != 5 || ls[4].ID != l.ID || l.Name != "Backlog" || l.IsDone {
		t.Fatalf("lists = %+v, created = %+v", ls, l)
	}
}

func TestCreateList_MemberForbidden(t *testing.T) {
	e := newEnv(t)
	_, err := e.svc.CreateList(e.ctx, member, e.pid, "X")
	if code(err) != "forbidden" {
		t.Fatalf("err = %v", err)
	}
	if len(e.lists(t)) != 4 {
		t.Fatal("forbidden write must not create a list")
	}
}

func TestMoveList_BetweenNeighbours(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	// move the last list between the first two
	got, err := e.svc.MoveList(e.ctx, manager, ls[3].ID, board.MoveInput{BeforeID: &ls[0].ID, AfterID: &ls[1].ID})
	if err != nil {
		t.Fatal(err)
	}
	after := e.lists(t)
	want := []int64{ls[0].ID, ls[3].ID, ls[1].ID, ls[2].ID}
	for i, l := range after {
		if l.ID != want[i] {
			t.Fatalf("order = %+v, want ids %v", after, want)
		}
	}
	if got.Position != after[1].Position {
		t.Fatalf("returned position %q != stored %q", got.Position, after[1].Position)
	}
	// only a before neighbour: lands directly after it, not at the end
	if _, err := e.svc.MoveList(e.ctx, manager, ls[3].ID, board.MoveInput{BeforeID: &ls[1].ID}); err != nil {
		t.Fatal(err)
	}
	if after = e.lists(t); after[2].ID != ls[3].ID {
		t.Fatalf("order = %+v", after)
	}
	// to the front
	if _, err := e.svc.MoveList(e.ctx, manager, ls[3].ID, board.MoveInput{AfterID: &ls[0].ID}); err != nil {
		t.Fatal(err)
	}
	if after = e.lists(t); after[0].ID != ls[3].ID {
		t.Fatalf("order = %+v", after)
	}
	if _, err := e.svc.MoveList(e.ctx, member, ls[3].ID, board.MoveInput{BeforeID: &ls[0].ID}); code(err) != "forbidden" {
		t.Fatalf("member move err = %v", err)
	}
}

func TestMoveList_StaleNeighboursConflict(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)

	// a second project's list is a foreign neighbour
	p2, err := e.proj.Create(e.ctx, manager, project.CreateProjectInput{Name: "P2", Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	var foreign store.List
	e.update(t, func(r store.Repos) error {
		b, _ := r.Boards.ByProject(e.ctx, p2.ID)
		all, _ := r.Lists.ByBoard(e.ctx, b.ID)
		foreign = all[0]
		return nil
	})
	if _, err := e.svc.ArchiveList(e.ctx, manager, ls[2].ID); err != nil {
		t.Fatal(err)
	}
	before := e.lists(t)

	cases := map[string]board.MoveInput{
		"foreign before": {BeforeID: &foreign.ID, AfterID: &ls[1].ID},
		"foreign after":  {BeforeID: &ls[0].ID, AfterID: &foreign.ID},
		"reversed":       {BeforeID: &ls[1].ID, AfterID: &ls[0].ID},
		"archived":       {BeforeID: &ls[2].ID},
		"itself":         {BeforeID: &ls[3].ID},
		"unknown id":     {BeforeID: ptr(int64(9999))},
	}
	for name, in := range cases {
		_, err := e.svc.MoveList(e.ctx, manager, ls[3].ID, in)
		if code(err) != "conflict" || msg(err) != "stale_order" {
			t.Errorf("%s: err = %v (code %q)", name, err, code(err))
		}
	}
	after := e.lists(t)
	for i := range before {
		if before[i].ID != after[i].ID || before[i].Position != after[i].Position {
			t.Fatalf("stale move wrote: %+v -> %+v", before, after)
		}
	}
}

func TestMoveList_RebalancesOnNoGap(t *testing.T) {
	e := newEnv(t)
	bid := e.boardID(t)
	// two keys with no room: Between would need more than the max key length
	tight := "a" + strings.Repeat("0", 60) + "1"
	var a, b, c store.List
	e.update(t, func(r store.Repos) error {
		all, _ := r.Lists.ByBoard(e.ctx, bid)
		for _, l := range all {
			l.ArchivedAt = ptr(t0) // clear the seeded lists out of the way
			if err := r.Lists.Save(e.ctx, l); err != nil {
				return err
			}
		}
		mk := func(name, pos string) store.List {
			l, _ := r.Lists.Create(e.ctx, store.List{BoardID: bid, Name: name, Position: pos, CreatedAt: t0, UpdatedAt: t0})
			return l
		}
		a, b, c = mk("a", "a"), mk("b", tight), mk("c", "z")
		return nil
	})
	if _, err := e.svc.MoveList(e.ctx, manager, c.ID, board.MoveInput{BeforeID: &a.ID, AfterID: &b.ID}); err != nil {
		t.Fatal(err)
	}
	got := e.lists(t)
	var active []store.List
	for _, l := range got {
		if l.ArchivedAt == nil {
			active = append(active, l)
		}
	}
	if len(active) != 3 || active[0].ID != a.ID || active[1].ID != c.ID || active[2].ID != b.ID {
		t.Fatalf("order = %+v", active)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Position >= got[i].Position {
			t.Fatalf("positions not strictly ascending: %+v", got)
		}
	}
}

func TestPlace_PureLogic(t *testing.T) {
	sibs := []store.IDPos{{ID: 1, Position: "d"}, {ID: 2, Position: "m"}, {ID: 3, Position: "t"}}
	id := func(v int64) *int64 { return &v }
	p, err := board.Place(sibs, 9, board.MoveInput{BeforeID: id(1), AfterID: id(2)})
	if err != nil || p.Position <= "d" || p.Position >= "m" || p.Rebalanced != nil {
		t.Fatalf("between = %+v, %v", p, err)
	}
	p, err = board.Place(sibs, 9, board.MoveInput{})
	if err != nil || p.Position <= "t" {
		t.Fatalf("append = %+v, %v", p, err)
	}
	// the moving item is ignored as a sibling
	p, err = board.Place(sibs, 2, board.MoveInput{BeforeID: id(1), AfterID: id(3)})
	if err != nil || p.Position <= "d" || p.Position >= "t" {
		t.Fatalf("self-skip = %+v, %v", p, err)
	}
	if _, err = board.Place(sibs, 9, board.MoveInput{BeforeID: id(2), AfterID: id(1)}); msg(err) != "stale_order" {
		t.Fatalf("reversed err = %v", err)
	}
}

func TestUpdateList_IsDoneSetsAndClearsCompletedAt(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	open := e.card(t, ls[1].ID, "open", "m")
	var done store.Card
	earlier := t0.Add(-time.Hour)
	e.update(t, func(r store.Repos) error {
		var err error
		done, err = r.Cards.Create(e.ctx, store.Card{ListID: ls[1].ID, Title: "done", Position: "n", CompletedAt: &earlier})
		return err
	})
	*e.tick = 5
	l, err := e.svc.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{IsDone: ptr(true)})
	if err != nil || !l.IsDone {
		t.Fatalf("update = %+v, %v", l, err)
	}
	if c := e.getCard(t, open.ID); c.CompletedAt == nil || !c.CompletedAt.Equal(t0.Add(5*time.Minute)) {
		t.Fatalf("open card completedAt = %v", c.CompletedAt)
	}
	if c := e.getCard(t, done.ID); c.CompletedAt == nil || !c.CompletedAt.Equal(earlier) {
		t.Fatalf("already-completed card must keep its time, got %v", c.CompletedAt)
	}
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{IsDone: ptr(false), Name: ptr("Doing")}); err != nil {
		t.Fatal(err)
	}
	if c := e.getCard(t, open.ID); c.CompletedAt != nil {
		t.Fatalf("completedAt not cleared: %v", c.CompletedAt)
	}
	if c := e.getCard(t, done.ID); c.CompletedAt != nil {
		t.Fatalf("completedAt not cleared: %v", c.CompletedAt)
	}
	if e.lists(t)[1].Name != "Doing" {
		t.Fatal("name not saved")
	}
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{Name: ptr("")}); code(err) != "validation_failed" {
		t.Fatalf("empty name err = %v", err)
	}
}

func TestUpdateList_ArchivedProjectConflict(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	if _, err := e.proj.Archive(e.ctx, manager, e.pid); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[0].ID, board.UpdateListInput{Name: ptr("N")}); !projectArchived(err) {
		t.Fatalf("update err = %v", err)
	}
	if _, err := e.svc.CreateList(e.ctx, manager, e.pid, "N"); !projectArchived(err) {
		t.Fatalf("create err = %v", err)
	}
	if _, err := e.svc.MoveList(e.ctx, manager, ls[3].ID, board.MoveInput{BeforeID: &ls[0].ID}); !projectArchived(err) {
		t.Fatalf("move err = %v", err)
	}
	if _, err := e.svc.ArchiveList(e.ctx, manager, ls[0].ID); !projectArchived(err) {
		t.Fatalf("archive err = %v", err)
	}
	if v, _, err := e.svc.Board(e.ctx, manager, e.pid); err != nil || len(v.Lists) != 4 {
		t.Fatalf("reads still work: %v", err)
	}
}

func TestArchiveRestoreList(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	if _, err := e.svc.ArchiveList(e.ctx, manager, ls[0].ID); err != nil {
		t.Fatal(err)
	}
	l, err := e.svc.RestoreList(e.ctx, manager, ls[0].ID)
	if err != nil || l.ArchivedAt != nil {
		t.Fatalf("restore = %+v, %v", l, err)
	}
	after := e.lists(t)
	if after[len(after)-1].ID != ls[0].ID {
		t.Fatalf("restored list must be last: %+v", after)
	}
	if _, err := e.svc.RestoreList(e.ctx, manager, ls[0].ID); err != nil {
		t.Fatalf("restoring an active list is a no-op: %v", err)
	}
}

func TestWrites_BumpBoardAndLogActivity(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	*e.tick = 3
	n := len(e.st.Activity())
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[0].ID, board.UpdateListInput{Name: ptr("N")}); err != nil {
		t.Fatal(err)
	}
	v, _, _ := e.svc.Board(e.ctx, manager, e.pid)
	if !v.Board.UpdatedAt.Equal(t0.Add(3 * time.Minute)) {
		t.Fatalf("board updatedAt = %v", v.Board.UpdatedAt)
	}
	ev := e.st.Activity()
	if len(ev) != n+1 || ev[n].Type != "list.updated" || ev[n].ActorID != manager {
		t.Fatalf("activity = %+v", ev[n:])
	}
}

func TestListRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	if _, err := e.svc.UpdateList(e.ctx, outside, ls[0].ID, board.UpdateListInput{Name: ptr("N")}); code(err) != "not_found" {
		t.Fatalf("update err = %v", err)
	}
	if _, err := e.svc.MoveList(e.ctx, outside, ls[0].ID, board.MoveInput{}); code(err) != "not_found" {
		t.Fatalf("move err = %v", err)
	}
	if _, err := e.svc.ArchiveList(e.ctx, outside, ls[0].ID); code(err) != "not_found" {
		t.Fatalf("archive err = %v", err)
	}
	if _, err := e.svc.RestoreList(e.ctx, outside, ls[0].ID); code(err) != "not_found" {
		t.Fatalf("restore err = %v", err)
	}
	if _, err := e.svc.ArchiveList(e.ctx, manager, 9999); code(err) != "not_found" {
		t.Fatalf("unknown list err = %v", err)
	}
}

func TestUpdateList_IsDoneAgainStampsNewCards(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{IsDone: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	late := e.card(t, ls[1].ID, "late", "m")
	*e.tick = 2
	if _, err := e.svc.UpdateList(e.ctx, manager, ls[1].ID, board.UpdateListInput{IsDone: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if c := e.getCard(t, late.ID); c.CompletedAt == nil || !c.CompletedAt.Equal(t0.Add(2*time.Minute)) {
		t.Fatalf("new card completedAt = %v", c.CompletedAt)
	}
}

func TestPlaceLocked_LockFirstAndArchivedNeighbourStale(t *testing.T) {
	var order []string
	sibs := []store.IDPos{{ID: 1, Position: "d"}, {ID: 2, Position: "m", Archived: true}, {ID: 3, Position: "t"}}
	lock := func(context.Context) error { order = append(order, "lock"); return nil }
	read := func(context.Context) ([]store.IDPos, error) { order = append(order, "read"); return sibs, nil }
	write := func(context.Context, []store.IDPos) error { return nil }
	two, one := int64(2), int64(1)
	_, err := board.PlaceLocked(context.Background(), lock, read, write, 9, board.MoveInput{BeforeID: &two})
	if msg(err) != "stale_order" || len(order) != 2 || order[0] != "lock" {
		t.Fatalf("err = %v order = %v", err, order)
	}
	pos, err := board.PlaceLocked(context.Background(), lock, read, write, 9, board.MoveInput{BeforeID: &one})
	if err != nil || pos <= "d" {
		t.Fatalf("pos = %q err = %v", pos, err)
	}
}

// projectArchived is the conflict token the UI keys on for an archived project.
func projectArchived(err error) bool {
	return code(err) == "conflict" && err.Error() == "project_archived"
}

func TestUpdateList_NonMemberLooksLikeMissing(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	_, a := e.svc.UpdateList(e.ctx, outside, l, board.UpdateListInput{Name: ptr("N")})
	_, b := e.svc.UpdateList(e.ctx, manager, 999, board.UpdateListInput{Name: ptr("N")})
	if code(a) != "not_found" || a.Error() != b.Error() {
		t.Fatalf("outsider %v, missing %v", a, b)
	}
}

func TestSnapshot_ChecklistPreviewFirstThreeByPosition(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	with := e.card(t, l, "with", "a")
	none := e.card(t, l, "none", "b")
	e.update(t, func(r store.Repos) error {
		// created out of position order; ids do not match position order
		for _, it := range []struct {
			text, pos string
			done      bool
		}{{"d", "d", false}, {"b", "b", true}, {"a", "a", false}, {"c", "c", false}} {
			if _, err := r.Checklist.Create(e.ctx, store.ChecklistItem{CardID: with.ID, Text: it.text, IsDone: it.done, Position: it.pos, UpdatedAt: t0}); err != nil {
				return err
			}
		}
		return nil
	})
	v, _, err := e.svc.Board(e.ctx, member2, e.pid)
	if err != nil {
		t.Fatal(err)
	}
	by := map[int64]board.CardSummaryView{}
	for _, c := range v.Cards {
		by[c.ID] = c
	}
	pv := by[with.ID].ChecklistPreview
	if len(pv) != 3 || pv[0].Text != "a" || pv[1].Text != "b" || !pv[1].IsDone || pv[2].Text != "c" {
		t.Fatalf("preview = %+v", pv)
	}
	if by[with.ID].ChecklistTotal != 4 {
		t.Fatalf("total = %d", by[with.ID].ChecklistTotal)
	}
	if by[none.ID].ChecklistPreview == nil || len(by[none.ID].ChecklistPreview) != 0 {
		t.Fatalf("empty preview must be non-nil empty, got %#v", by[none.ID].ChecklistPreview)
	}
	b, _ := json.Marshal(by[none.ID])
	if !strings.Contains(string(b), `"checklistPreview":[]`) {
		t.Fatalf("json = %s", b)
	}
}
