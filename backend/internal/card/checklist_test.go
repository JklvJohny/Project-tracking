package card_test

import (
	"strings"
	"testing"

	"tracking-service/internal/board"
	"tracking-service/internal/card"
)

func (e env) addItem(t *testing.T, cardID int64, text string) card.ChecklistItemView {
	t.Helper()
	it, err := e.svc.AddItem(e.ctx, member, cardID, text)
	if err != nil {
		t.Fatal(err)
	}
	return it
}

func (e env) itemOrder(t *testing.T, cardID int64) []int64 {
	t.Helper()
	d, err := e.svc.Get(e.ctx, member, cardID)
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, it := range d.Checklist {
		ids = append(ids, it.ID)
	}
	return ids
}

func (e env) checklistEvents(typ string) (n int) {
	for _, ev := range e.st.Activity() {
		if ev.Type == typ {
			n++
		}
	}
	return n
}

func TestAddItem_AppendsInOrder(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	a, b := e.addItem(t, c.ID, "a"), e.addItem(t, c.ID, "b")
	if got := e.itemOrder(t, c.ID); len(got) != 2 || got[0] != a.ID || got[1] != b.ID {
		t.Fatalf("order = %v", got)
	}
	if e.checklistEvents("checklist.added") != 2 {
		t.Fatal("events missing")
	}
}

func TestAddItem_ArchivedCardConflict(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	if _, err := e.svc.Archive(e.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.AddItem(e.ctx, member, c.ID, "x"); code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
}

func TestAddItem_TooLongValidation(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	_, err := e.svc.AddItem(e.ctx, member, c.ID, strings.Repeat("ก", 501))
	if code(err) != "validation_failed" || fieldsOf(err)["text"] != "too_long" {
		t.Fatalf("err = %v %v", err, fieldsOf(err))
	}
	if _, err = e.svc.AddItem(e.ctx, member, c.ID, strings.Repeat("ก", 500)); err != nil {
		t.Fatalf("500 runes: %v", err)
	}
}

func TestToggle_UpdatesBoardCounts(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	it := e.addItem(t, c.ID, "a")
	counts := func() (int, int) {
		v, _, err := e.board.Board(e.ctx, member, e.pid)
		if err != nil {
			t.Fatal(err)
		}
		for _, cs := range v.Cards {
			if cs.ID == c.ID {
				return cs.ChecklistDone, cs.ChecklistTotal
			}
		}
		t.Fatal("card not on board")
		return 0, 0
	}
	if d, n := counts(); d != 0 || n != 1 {
		t.Fatalf("before = %d/%d", d, n)
	}
	before := e.boardUpdatedAt(t)
	*e.tick = 7
	got, err := e.svc.UpdateItem(e.ctx, member, it.ID, card.ItemPatch{IsDone: ptr(true)})
	if err != nil || !got.IsDone {
		t.Fatalf("toggle: %v %+v", err, got)
	}
	if d, n := counts(); d != 1 || n != 1 {
		t.Fatalf("after = %d/%d", d, n)
	}
	if !e.boardUpdatedAt(t).After(before) {
		t.Fatal("board not bumped")
	}
	if cd, _ := e.svc.Get(e.ctx, member, c.ID); !cd.UpdatedAt.Equal(t0.Add(7 * 60e9)) {
		t.Fatalf("card not touched: %v", cd.UpdatedAt)
	}
}

func TestUpdateItem_EmptyPatchAndText(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	it := e.addItem(t, c.ID, "a")
	if _, err := e.svc.UpdateItem(e.ctx, member, it.ID, card.ItemPatch{}); code(err) != "bad_request" {
		t.Fatalf("empty: %v", err)
	}
	if e.checklistEvents("checklist.updated") != 0 {
		t.Fatal("empty patch logged an event")
	}
	if _, err := e.svc.UpdateItem(e.ctx, member, it.ID, card.ItemPatch{Text: ptr("  ")}); code(err) != "validation_failed" {
		t.Fatalf("blank: %v", err)
	}
	got, err := e.svc.UpdateItem(e.ctx, member, it.ID, card.ItemPatch{Text: ptr("b")})
	if err != nil || got.Text != "b" {
		t.Fatalf("text: %v %+v", err, got)
	}
}

func TestMoveItem_ReordersAndNeighbourFromOtherCardConflict(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0].ID
	c1, c2 := e.mk(t, l, "c1"), e.mk(t, l, "c2")
	a, b, d := e.addItem(t, c1.ID, "a"), e.addItem(t, c1.ID, "b"), e.addItem(t, c1.ID, "d")
	other := e.addItem(t, c2.ID, "o")
	if _, err := e.svc.MoveItem(e.ctx, member, d.ID, board.MoveInput{AfterID: &a.ID}); err != nil {
		t.Fatal(err)
	}
	if got := e.itemOrder(t, c1.ID); got[0] != d.ID || got[1] != a.ID || got[2] != b.ID {
		t.Fatalf("order = %v", got)
	}
	if _, err := e.svc.MoveItem(e.ctx, member, a.ID, board.MoveInput{BeforeID: &other.ID}); code(err) != "conflict" {
		t.Fatalf("foreign neighbour: %v", err)
	}
}

func TestDeleteItem_RemovesAndLogs(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	it := e.addItem(t, c.ID, "a")
	if err := e.svc.DeleteItem(e.ctx, member, it.ID); err != nil {
		t.Fatal(err)
	}
	if len(e.itemOrder(t, c.ID)) != 0 || e.checklistEvents("checklist.deleted") != 1 {
		t.Fatal("not deleted")
	}
	if err := e.svc.DeleteItem(e.ctx, member, it.ID); code(err) != "not_found" {
		t.Fatalf("again: %v", err)
	}
}

func TestItem_Permissions(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	it := e.addItem(t, c.ID, "a")
	if _, err := e.svc.AddItem(e.ctx, viewer, c.ID, "x"); code(err) != "forbidden" {
		t.Fatalf("viewer add: %v", err)
	}
	if _, err := e.svc.UpdateItem(e.ctx, viewer, it.ID, card.ItemPatch{IsDone: ptr(true)}); code(err) != "forbidden" {
		t.Fatalf("viewer update: %v", err)
	}
	if err := e.svc.DeleteItem(e.ctx, outside, it.ID); code(err) != "not_found" {
		t.Fatalf("outside: %v", err)
	}
}

func TestItemRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	it := e.addItem(t, c.ID, "a")
	for _, rc := range []struct{ method, path, body string }{
		{"POST", "/cards/" + id(c.ID) + "/checklist", `{"text":"x"}`},
		{"PATCH", "/checklist/" + id(it.ID), `{"isDone":true}`},
		{"POST", "/checklist/" + id(it.ID) + "/move", `{}`},
		{"DELETE", "/checklist/" + id(it.ID), ""},
	} {
		if rec, body := do(h, outside, rc.method, rc.path, rc.body); rec.Code != 404 || body["data"] != nil {
			t.Errorf("%s %s = %d %s", rc.method, rc.path, rec.Code, rec.Body)
		}
	}
	if rec, body := do(h, member, "POST", "/cards/"+id(c.ID)+"/checklist", `{"text":"x"}`); rec.Code != 201 || body["data"] == nil {
		t.Fatalf("add = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := do(h, member, "PATCH", "/checklist/"+id(it.ID), `{"isDone":true}`); rec.Code != 200 {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := do(h, member, "POST", "/checklist/"+id(it.ID)+"/move", `{}`); rec.Code != 200 {
		t.Fatalf("move = %d %s", rec.Code, rec.Body)
	}
	if rec, body := do(h, member, "DELETE", "/checklist/"+id(it.ID), ""); rec.Code != 200 || body["data"] == nil {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
}
