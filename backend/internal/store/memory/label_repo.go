package memory

import (
	"context"
	"sort"
	"strings"

	"tracking-service/internal/store"
)

type labelRepo struct{ d *data }

func (r *labelRepo) Create(_ context.Context, l store.Label) (store.Label, error) {
	l.ID = r.d.nextID("labels")
	r.d.labels[l.ID] = l
	return l, nil
}

func (r *labelRepo) Get(_ context.Context, id int64) (store.Label, error) {
	l, ok := r.d.labels[id]
	if !ok {
		return store.Label{}, store.ErrNotFound
	}
	return l, nil
}

func (r *labelRepo) Save(_ context.Context, l store.Label) error {
	if _, ok := r.d.labels[l.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.labels[l.ID] = l
	return nil
}

func (r *labelRepo) ByProject(_ context.Context, projectID int64) ([]store.Label, error) {
	out := []store.Label{}
	for _, l := range r.d.labels {
		if l.ProjectID == projectID {
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (r *labelRepo) NameTaken(_ context.Context, projectID int64, name string, exceptID int64) (bool, error) {
	for _, l := range r.d.labels {
		if l.ProjectID == projectID && l.ID != exceptID && strings.EqualFold(l.Name, name) {
			return true, nil
		}
	}
	return false, nil
}

func (r *labelRepo) Delete(_ context.Context, id int64) ([]int64, error) {
	if _, ok := r.d.labels[id]; !ok {
		return nil, store.ErrNotFound
	}
	delete(r.d.labels, id)
	cards := []int64{}
	for k := range r.d.cardLabels {
		if k.LabelID == id {
			cards = append(cards, k.CardID)
			delete(r.d.cardLabels, k)
		}
	}
	sortIDs(cards)
	return cards, nil
}
