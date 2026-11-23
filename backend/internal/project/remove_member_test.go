package project_test

import (
	"testing"

	"tracking-service/internal/store"
)

// Removing someone from a project takes them off its cards, archived ones too,
// and leaves their cards in other projects alone.
func TestRemoveMember_UnassignsTheirCardsInThatProjectOnly(t *testing.T) {
	e := newEnv(t)
	a := e.mustCreate(t, manager, "A")
	b := e.mustCreate(t, manager, "B")
	for _, pid := range []int64{a.ID, b.ID} {
		if _, err := e.svc.AddMember(e.ctx, manager, pid, regular, "member"); err != nil {
			t.Fatal(err)
		}
	}
	card := func(projectID int64, archived bool) int64 {
		var id int64
		l := e.listsOf(t, projectID)[0]
		err := e.st.Update(e.ctx, func(r store.Repos) error {
			c := store.Card{ListID: l.ID, Title: "c", Position: "m"}
			if archived {
				c.ArchivedAt = &t0
				c.Position = "n"
			}
			c, err := r.Cards.Create(e.ctx, c)
			if err != nil {
				return err
			}
			id = c.ID
			_, err = r.Cards.AddAssignee(e.ctx, c.ID, regular, t0)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	inA, archivedInA, inB := card(a.ID, false), card(a.ID, true), card(b.ID, false)

	if err := e.svc.RemoveMember(e.ctx, manager, a.ID, regular); err != nil {
		t.Fatal(err)
	}

	err := e.st.View(e.ctx, func(r store.Repos) error {
		for id, want := range map[int64]int{inA: 0, archivedInA: 0, inB: 1} {
			ch, err := r.Cards.Children(e.ctx, id)
			if err != nil {
				return err
			}
			if len(ch.AssigneeIDs) != want {
				t.Errorf("card %d has %d assignees, want %d", id, len(ch.AssigneeIDs), want)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var events int
	for _, ev := range e.st.Activity() {
		if ev.Type == "card.unassigned" && ev.ProjectID == a.ID {
			events++
		}
	}
	if events != 2 {
		t.Fatalf("card.unassigned events = %d, want 2", events)
	}
}
