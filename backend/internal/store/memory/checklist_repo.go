package memory

import (
	"context"
	"sort"

	"tracking-service/internal/store"
)

type checklistRepo struct{ d *data }

// LockCard needs no work here: Update already holds the store's write lock.
func (r *checklistRepo) LockCard(_ context.Context, cardID int64) error {
	if _, ok := r.d.cards[cardID]; !ok {
		return store.ErrNotFound
	}
	return nil
}

func (r *checklistRepo) Create(_ context.Context, it store.ChecklistItem) (store.ChecklistItem, error) {
	it.ID = r.d.nextID("checklist_items")
	r.d.checklist[it.ID] = it
	return it, nil
}

func (r *checklistRepo) Get(_ context.Context, id int64) (store.ChecklistItem, error) {
	it, ok := r.d.checklist[id]
	if !ok {
		return it, store.ErrNotFound
	}
	return it, nil
}

func (r *checklistRepo) Save(_ context.Context, it store.ChecklistItem) error {
	if _, ok := r.d.checklist[it.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.checklist[it.ID] = it
	return nil
}

func (r *checklistRepo) Delete(_ context.Context, id int64) error {
	if _, ok := r.d.checklist[id]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.checklist, id)
	return nil
}

func (r *checklistRepo) Positions(_ context.Context, cardID int64) ([]store.IDPos, error) {
	out := []store.IDPos{}
	for _, it := range r.d.checklist {
		if it.CardID == cardID {
			out = append(out, store.IDPos{ID: it.ID, Position: it.Position})
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

func (r *checklistRepo) SetPositions(_ context.Context, ps []store.IDPos) error {
	for _, p := range ps {
		it, ok := r.d.checklist[p.ID]
		if !ok {
			return store.ErrNotFound
		}
		it.Position = p.Position
		r.d.checklist[p.ID] = it
	}
	return nil
}
