package memory

import (
	"context"
	"sort"
	"time"

	"tracking-service/internal/store"
)

type documentRepo struct{ d *data }

func (r *documentRepo) Create(_ context.Context, d store.Document) (store.Document, error) {
	d.ID = r.d.nextID("documents")
	r.d.documents[d.ID] = d
	return d, nil
}

func (r *documentRepo) Get(_ context.Context, id int64) (store.Document, error) {
	d, ok := r.d.documents[id]
	if !ok {
		return d, store.ErrNotFound
	}
	return d, nil
}

func (r *documentRepo) SetDeleted(_ context.Context, id int64, at *time.Time) (bool, error) {
	d, ok := r.d.documents[id]
	if !ok {
		return false, store.ErrNotFound
	}
	if (d.DeletedAt != nil) == (at != nil) {
		return false, nil
	}
	d.DeletedAt = ptr(at)
	r.d.documents[id] = d
	return true, nil
}

func (r *documentRepo) ByProject(_ context.Context, projectID int64) ([]store.Document, error) {
	out := []store.Document{}
	for _, d := range r.d.documents {
		if d.ProjectID == projectID && d.DeletedAt == nil {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	return out, nil
}
