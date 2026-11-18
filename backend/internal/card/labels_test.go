package card_test

import (
	"testing"

	"tracking-service/internal/project"
)

func (e env) label(t *testing.T, pid int64, name string) project.LabelView {
	t.Helper()
	l, err := e.proj.CreateLabel(e.ctx, manager, pid, project.LabelInput{Name: name, Color: "red"})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func (e env) labelEvents() (n int) {
	for _, ev := range e.st.Activity() {
		if ev.Type == "card.labeled" || ev.Type == "card.unlabeled" {
			n++
		}
	}
	return n
}

func TestAddLabel_OtherProjectLabelNotFound(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	foreign := e.label(t, e.newProject(t, "Q"), "Bug")
	for _, lid := range []int64{foreign.ID, 9999} {
		_, err := e.svc.AddLabel(e.ctx, member, c.ID, lid)
		if code(err) != "not_found" {
			t.Fatalf("label %d: %v", lid, err)
		}
	}
}

func TestAddLabel_IdempotentAndRemove(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	l := e.label(t, e.pid, "Bug")
	*e.tick = 1
	got, err := e.svc.AddLabel(e.ctx, member, c.ID, l.ID)
	if err != nil || len(got.LabelIDs) != 1 || got.LabelIDs[0] != l.ID {
		t.Fatalf("add: %v %+v", err, got)
	}
	if !got.UpdatedAt.Equal(t0.Add(1 * 60e9)) {
		t.Fatalf("card not touched: %v", got.UpdatedAt)
	}
	n, board := e.labelEvents(), e.boardUpdatedAt(t)
	*e.tick = 5
	if got, err = e.svc.AddLabel(e.ctx, member, c.ID, l.ID); err != nil || len(got.LabelIDs) != 1 {
		t.Fatalf("repeat: %v %+v", err, got)
	}
	if e.labelEvents() != n || !e.boardUpdatedAt(t).Equal(board) || !got.UpdatedAt.Equal(t0.Add(1*60e9)) {
		t.Fatal("repeat add wrote something")
	}
	if got, err = e.svc.RemoveLabel(e.ctx, member, c.ID, l.ID); err != nil || len(got.LabelIDs) != 0 {
		t.Fatalf("remove: %v %+v", err, got)
	}
	n = e.labelEvents()
	if _, err = e.svc.RemoveLabel(e.ctx, member, c.ID, l.ID); err != nil || e.labelEvents() != n {
		t.Fatalf("remove absent: %v events %d vs %d", err, e.labelEvents(), n)
	}
}

func TestAddLabel_PermissionsAndArchivedCard(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	l := e.label(t, e.pid, "Bug")
	if _, err := e.svc.AddLabel(e.ctx, viewer, c.ID, l.ID); code(err) != "forbidden" {
		t.Fatalf("viewer: %v", err)
	}
	if _, err := e.svc.AddLabel(e.ctx, outside, c.ID, l.ID); code(err) != "not_found" {
		t.Fatalf("outside: %v", err)
	}
	if _, err := e.svc.Archive(e.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.AddLabel(e.ctx, member, c.ID, l.ID); code(err) != "conflict" {
		t.Fatalf("archived card: %v", err)
	}
}

func TestDeleteLabel_RemovesFromCardsAndBumpsBoard(t *testing.T) {
	e := newEnv(t)
	ls := e.lists(t)
	c1, c2 := e.mk(t, ls[0].ID, "c1"), e.mk(t, ls[0].ID, "c2")
	l, keep := e.label(t, e.pid, "Bug"), e.label(t, e.pid, "Keep")
	for _, lid := range []int64{l.ID, keep.ID} {
		if _, err := e.svc.AddLabel(e.ctx, member, c1.ID, lid); err != nil {
			t.Fatal(err)
		}
	}
	before := e.boardUpdatedAt(t)
	*e.tick = 30
	if err := e.proj.DeleteLabel(e.ctx, manager, l.ID); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.Get(e.ctx, member, c1.ID)
	if err != nil || len(got.LabelIDs) != 1 || got.LabelIDs[0] != keep.ID {
		t.Fatalf("c1 labels: %v %+v", err, got.LabelIDs)
	}
	if !got.UpdatedAt.Equal(t0.Add(30 * 60e9)) {
		t.Fatalf("c1 not touched: %v", got.UpdatedAt)
	}
	if g2, _ := e.svc.Get(e.ctx, member, c2.ID); g2.UpdatedAt.Equal(got.UpdatedAt) {
		t.Fatal("card without the label was touched")
	}
	if !e.boardUpdatedAt(t).After(before) {
		t.Fatal("board not bumped")
	}
	if _, err := e.svc.AddLabel(e.ctx, member, c2.ID, l.ID); code(err) != "not_found" {
		t.Fatalf("deleted label: %v", err)
	}
	snap, _, err := e.board.Board(e.ctx, member, e.pid)
	if err != nil || len(snap.Labels) != 1 {
		t.Fatalf("board labels: %v %+v", err, snap.Labels)
	}
}

func TestCardLabelRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	l := e.label(t, e.pid, "Bug")
	path := "/cards/" + id(c.ID) + "/labels/" + id(l.ID)
	for _, m := range []string{"PUT", "DELETE"} {
		if rec, body := do(h, outside, m, path, ""); rec.Code != 404 || body["data"] != nil {
			t.Errorf("%s = %d %s", m, rec.Code, rec.Body)
		}
	}
	if rec, _ := do(h, member, "PUT", path, ""); rec.Code != 200 {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := do(h, member, "DELETE", path, ""); rec.Code != 200 {
		t.Fatalf("delete = %d", rec.Code)
	}
}
