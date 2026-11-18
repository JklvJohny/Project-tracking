package memory

import (
	"context"
	"sort"
	"time"

	"tracking-service/internal/store"
)

// Touch, LockList and the rest of the card repo's later-task methods live
// here; the base CRUD stays in board_repo.go.

func (r *cardRepo) Touch(_ context.Context, cardID int64, at time.Time) error {
	c, ok := r.d.cards[cardID]
	if !ok {
		return store.ErrNotFound
	}
	c.UpdatedAt = at
	r.d.cards[cardID] = c
	return nil
}

// LockList needs no work here: Update already holds the store's write lock.
func (r *cardRepo) LockList(_ context.Context, listID int64) error {
	if _, ok := r.d.lists[listID]; !ok {
		return store.ErrNotFound
	}
	return nil
}

func (r *cardRepo) Positions(_ context.Context, listID int64) ([]store.IDPos, error) {
	out := []store.IDPos{}
	for _, c := range r.d.cards {
		if c.ListID == listID {
			out = append(out, store.IDPos{ID: c.ID, Position: c.Position, Archived: c.ArchivedAt != nil})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Position != out[j].Position {
			return out[i].Position < out[j].Position
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (r *cardRepo) SetPositions(_ context.Context, ps []store.IDPos) error {
	for _, p := range ps {
		c, ok := r.d.cards[p.ID]
		if !ok {
			return store.ErrNotFound
		}
		c.Position = p.Position
		r.d.cards[p.ID] = c
	}
	return nil
}

func (r *cardRepo) AddAssignee(_ context.Context, cardID, userID int64, at time.Time) (bool, error) {
	if _, ok := r.d.cards[cardID]; !ok {
		return false, store.ErrNotFound
	}
	k := assigneeKey{CardID: cardID, UserID: userID}
	if _, ok := r.d.cardAssignees[k]; ok {
		return false, nil
	}
	r.d.cardAssignees[k] = store.CardAssignee{CardID: cardID, UserID: userID, AssignedAt: at}
	return true, nil
}

func (r *cardRepo) RemoveAssignee(_ context.Context, cardID, userID int64) (bool, error) {
	k := assigneeKey{CardID: cardID, UserID: userID}
	if _, ok := r.d.cardAssignees[k]; !ok {
		return false, nil
	}
	delete(r.d.cardAssignees, k)
	return true, nil
}

func (r *cardRepo) AddLabel(_ context.Context, cardID, labelID int64) (bool, error) {
	if _, ok := r.d.cards[cardID]; !ok {
		return false, store.ErrNotFound
	}
	k := cardLabelKey{CardID: cardID, LabelID: labelID}
	if _, ok := r.d.cardLabels[k]; ok {
		return false, nil
	}
	r.d.cardLabels[k] = store.CardLabel{CardID: cardID, LabelID: labelID}
	return true, nil
}

func (r *cardRepo) RemoveLabel(_ context.Context, cardID, labelID int64) (bool, error) {
	k := cardLabelKey{CardID: cardID, LabelID: labelID}
	if _, ok := r.d.cardLabels[k]; !ok {
		return false, nil
	}
	delete(r.d.cardLabels, k)
	return true, nil
}

func (r *cardRepo) Children(_ context.Context, cardID int64) (store.CardChildren, error) {
	ch := store.CardChildren{AssigneeIDs: []int64{}, LabelIDs: []int64{}, Checklist: []store.ChecklistItem{}}
	for k := range r.d.cardAssignees {
		if k.CardID == cardID {
			ch.AssigneeIDs = append(ch.AssigneeIDs, k.UserID)
		}
	}
	for k := range r.d.cardLabels {
		if k.CardID == cardID {
			ch.LabelIDs = append(ch.LabelIDs, k.LabelID)
		}
	}
	for _, it := range r.d.checklist {
		if it.CardID == cardID {
			ch.Checklist = append(ch.Checklist, it)
		}
	}
	sortIDs(ch.AssigneeIDs)
	sortIDs(ch.LabelIDs)
	sort.Slice(ch.Checklist, func(i, j int) bool {
		a, b := ch.Checklist[i], ch.Checklist[j]
		if a.Position != b.Position {
			return a.Position < b.Position
		}
		return a.ID < b.ID
	})
	return ch, nil
}
