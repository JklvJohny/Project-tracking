package card_test

import (
	"testing"

	"tracking-service/internal/board"
	"tracking-service/internal/card"
)

// An archived list is read-only, and so are the cards in it: they are off the
// board, so an edit there would go unseen until the list comes back.
func TestArchivedList_IsReadOnlyWithItsCards(t *testing.T) {
	e := newEnv(t)
	l := e.lists(t)[0]
	c := e.mk(t, l.ID, "c")
	if _, err := e.board.ArchiveList(e.ctx, manager, l.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Title: ptr("x")}); code(err) != "conflict" {
		t.Fatalf("edit card in archived list: %v", err)
	}
	if _, err := e.svc.Assign(e.ctx, member, c.ID, member); code(err) != "conflict" {
		t.Fatalf("assign in archived list: %v", err)
	}
	if _, err := e.board.UpdateList(e.ctx, manager, l.ID, board.UpdateListInput{Name: ptr("renamed")}); code(err) != "conflict" {
		t.Fatalf("rename archived list: %v", err)
	}
	// Restored, both are editable again.
	if _, err := e.board.RestoreList(e.ctx, manager, l.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Update(e.ctx, member, c.ID, card.UpdateCardInput{Title: ptr("x")}); err != nil {
		t.Fatalf("edit after restore: %v", err)
	}
}

// A card's checklist stops at 100 items.
func TestChecklist_StopsAtOneHundredItems(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	for i := range 100 {
		if _, err := e.svc.AddItem(e.ctx, member, c.ID, "item"); err != nil {
			t.Fatalf("item %d: %v", i+1, err)
		}
	}
	if _, err := e.svc.AddItem(e.ctx, member, c.ID, "one too many"); fieldsOf(err)["text"] != "too_many" {
		t.Fatalf("101st item: %v %v", err, fieldsOf(err))
	}
}
