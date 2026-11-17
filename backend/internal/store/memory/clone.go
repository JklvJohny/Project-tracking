package memory

import (
	"maps"
	"slices"

	"tracking-service/internal/store"
)

// clone copies every map including pointer and slice fields, so a write on
// the copy can never reach committed data through shared memory.
func (d *data) clone() *data {
	return &data{
		projects:      cloneMap(d.projects, cloneProject),
		members:       maps.Clone(d.members),
		boards:        maps.Clone(d.boards),
		lists:         cloneMap(d.lists, cloneList),
		cards:         cloneMap(d.cards, cloneCard),
		cardAssignees: maps.Clone(d.cardAssignees),
		cardLabels:    maps.Clone(d.cardLabels),
		labels:        maps.Clone(d.labels),
		checklist:     maps.Clone(d.checklist),
		comments:      cloneMap(d.comments, cloneComment),
		mentions:      maps.Clone(d.mentions),
		userRoles:     maps.Clone(d.userRoles),
		userCache:     maps.Clone(d.userCache),
		activity:      cloneEvents(d.activity),
		seq:           maps.Clone(d.seq),
	}
}

func cloneMap[K comparable, V any](m map[K]V, f func(V) V) map[K]V {
	out := make(map[K]V, len(m))
	for k, v := range m {
		out[k] = f(v)
	}
	return out
}

func ptr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func cloneProject(p store.Project) store.Project {
	p.StartDate, p.EndDate, p.ArchivedAt = ptr(p.StartDate), ptr(p.EndDate), ptr(p.ArchivedAt)
	return p
}

func cloneList(l store.List) store.List {
	l.WIPLimit, l.ArchivedAt = ptr(l.WIPLimit), ptr(l.ArchivedAt)
	return l
}

func cloneCard(c store.Card) store.Card {
	c.StartDate, c.DueDate = ptr(c.StartDate), ptr(c.DueDate)
	c.CompletedAt, c.ArchivedAt = ptr(c.CompletedAt), ptr(c.ArchivedAt)
	return c
}

func cloneComment(c store.Comment) store.Comment {
	c.EditedAt, c.DeletedAt = ptr(c.EditedAt), ptr(c.DeletedAt)
	return c
}

func cloneEvents(in []store.ActivityEvent) []store.ActivityEvent {
	out := make([]store.ActivityEvent, len(in))
	for i, e := range in {
		e.CardID = ptr(e.CardID)
		e.Payload = slices.Clone(e.Payload)
		out[i] = e
	}
	return out
}
