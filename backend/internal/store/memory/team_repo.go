package memory

import (
	"cmp"
	"context"
	"slices"
	"strings"

	"tracking-service/internal/store"
)

type teamRepo struct{ d *data }

func (r *teamRepo) Skills(_ context.Context) (map[int64][]string, error) {
	out := make(map[int64][]string, len(r.d.skills))
	for id, s := range r.d.skills {
		out[id] = slices.Clone(s)
	}
	return out, nil
}

func (r *teamRepo) SetSkills(_ context.Context, userID int64, skills []string) error {
	if len(skills) == 0 {
		delete(r.d.skills, userID)
		return nil
	}
	r.d.skills[userID] = slices.Clone(skills)
	return nil
}

func (r *teamRepo) Workload(_ context.Context, today, soon store.Date) (map[int64]store.Workload, error) {
	d := r.d
	out := map[int64]store.Workload{}
	for k := range d.cardAssignees {
		c, ok := d.cards[k.CardID]
		if !ok || c.ArchivedAt != nil || c.CompletedAt != nil {
			continue
		}
		l, ok := d.lists[c.ListID]
		if !ok || l.ArchivedAt != nil {
			continue
		}
		b, ok := d.boards[l.BoardID]
		if !ok {
			continue
		}
		if p, ok := d.projects[b.ProjectID]; !ok || p.ArchivedAt != nil {
			continue
		}
		w := out[k.UserID]
		w.Open++
		if c.DueDate != nil && *c.DueDate < today {
			w.Overdue++
		} else if c.DueDate != nil && *c.DueDate < soon {
			w.DueSoon++
		}
		out[k.UserID] = w
	}
	return out, nil
}

func (r *teamRepo) Catalog(_ context.Context) ([]store.CatalogSkill, error) {
	out := make([]store.CatalogSkill, 0, len(r.d.catalog))
	for _, s := range r.d.catalog {
		out = append(out, s)
	}
	slices.SortFunc(out, func(a, b store.CatalogSkill) int {
		return cmp.Or(cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)), cmp.Compare(a.Name, b.Name))
	})
	return out, nil
}

func (r *teamRepo) AddToCatalog(_ context.Context, s store.CatalogSkill) (bool, error) {
	k := strings.ToLower(s.Name)
	if _, ok := r.d.catalog[k]; ok {
		return false, nil
	}
	r.d.catalog[k] = s
	return true, nil
}

func (r *teamRepo) RemoveFromCatalog(_ context.Context, name string) error {
	k := strings.ToLower(name)
	if _, ok := r.d.catalog[k]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.catalog, k)
	return nil
}

func (r *teamRepo) SetSkillCategory(_ context.Context, s store.CatalogSkill) error {
	k := strings.ToLower(s.Name)
	if e, ok := r.d.catalog[k]; ok {
		e.CategoryID = s.CategoryID
		r.d.catalog[k] = e
		return nil
	}
	r.d.catalog[k] = s
	return nil
}

func (r *teamRepo) Categories(_ context.Context) ([]store.SkillCategory, error) {
	out := make([]store.SkillCategory, 0, len(r.d.categories))
	for _, c := range r.d.categories {
		out = append(out, c)
	}
	slices.SortFunc(out, func(a, b store.SkillCategory) int { return cmp.Compare(a.ID, b.ID) })
	return out, nil
}

func (r *teamRepo) categoryNamed(name string, except int64) bool {
	for _, c := range r.d.categories {
		if c.ID != except && strings.EqualFold(c.Name, name) {
			return true
		}
	}
	return false
}

func (r *teamRepo) CreateCategory(_ context.Context, c store.SkillCategory) (store.SkillCategory, error) {
	if r.categoryNamed(c.Name, 0) {
		return store.SkillCategory{}, store.ErrDuplicate
	}
	c.ID = r.d.nextID("skill_categories")
	r.d.categories[c.ID] = c
	return c, nil
}

func (r *teamRepo) RenameCategory(_ context.Context, id int64, name string) error {
	c, ok := r.d.categories[id]
	if !ok {
		return store.ErrNotFound
	}
	if r.categoryNamed(name, id) {
		return store.ErrDuplicate
	}
	c.Name = name
	r.d.categories[id] = c
	return nil
}

func (r *teamRepo) DeleteCategory(_ context.Context, id int64) error {
	if _, ok := r.d.categories[id]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.categories, id)
	// ON DELETE SET NULL.
	for k, s := range r.d.catalog {
		if s.CategoryID != nil && *s.CategoryID == id {
			s.CategoryID = nil
			r.d.catalog[k] = s
		}
	}
	return nil
}
