package memory

import (
	"context"
	"sort"
	"strings"
	"time"

	"tracking-service/internal/store"
)

type templateRepo struct{ d *data }

func (r *templateRepo) Create(_ context.Context, t store.ReportTemplate) (store.ReportTemplate, error) {
	t.ID = r.d.nextID("report_templates")
	r.d.templates[t.ID] = t
	return t, nil
}

func (r *templateRepo) Get(_ context.Context, id int64) (store.ReportTemplate, error) {
	t, ok := r.d.templates[id]
	if !ok {
		return t, store.ErrNotFound
	}
	return t, nil
}

func (r *templateRepo) SaveDetails(_ context.Context, t store.ReportTemplate) error {
	cur, ok := r.d.templates[t.ID]
	if !ok {
		return store.ErrNotFound
	}
	cur.Category, cur.Name, cur.Description, cur.UpdatedAt = t.Category, t.Name, t.Description, t.UpdatedAt
	r.d.templates[t.ID] = cur
	return nil
}

func (r *templateRepo) SetDeleted(_ context.Context, id int64, at *time.Time) error {
	t, ok := r.d.templates[id]
	if !ok {
		return store.ErrNotFound
	}
	t.DeletedAt = ptr(at)
	r.d.templates[id] = t
	return nil
}

func (r *templateRepo) List(_ context.Context) ([]store.ReportTemplate, error) {
	out := []store.ReportTemplate{}
	for _, t := range r.d.templates {
		if t.DeletedAt == nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if ca, cb := strings.ToLower(a.Category), strings.ToLower(b.Category); ca != cb {
			return ca < cb
		}
		if na, nb := strings.ToLower(a.Name), strings.ToLower(b.Name); na != nb {
			return na < nb
		}
		return a.ID < b.ID
	})
	return out, nil
}
