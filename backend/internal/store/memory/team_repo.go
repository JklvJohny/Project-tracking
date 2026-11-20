package memory

import (
	"context"
	"slices"

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
