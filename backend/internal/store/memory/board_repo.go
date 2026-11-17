package memory

import (
	"context"
	"sort"
	"time"

	"tracking-service/internal/store"
)

type boardRepo struct{ d *data }

func (r *boardRepo) Create(_ context.Context, b store.Board) (store.Board, error) {
	b.ID = r.d.nextID("boards")
	r.d.boards[b.ID] = b
	return b, nil
}

func (r *boardRepo) Get(_ context.Context, id int64) (store.Board, error) {
	b, ok := r.d.boards[id]
	if !ok {
		return store.Board{}, store.ErrNotFound
	}
	return b, nil
}

func (r *boardRepo) ByProject(_ context.Context, projectID int64) (store.Board, error) {
	for _, b := range r.d.boards {
		if b.ProjectID == projectID {
			return b, nil
		}
	}
	return store.Board{}, store.ErrNotFound
}

func (r *boardRepo) Touch(_ context.Context, boardID int64, at time.Time) error {
	b, ok := r.d.boards[boardID]
	if !ok {
		return store.ErrNotFound
	}
	b.UpdatedAt = at
	r.d.boards[boardID] = b
	return nil
}

func (r *boardRepo) Snapshot(ctx context.Context, projectID int64) (store.BoardSnapshot, error) {
	d := r.d
	b, err := r.ByProject(ctx, projectID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	snap := store.BoardSnapshot{Board: b, Project: cloneProject(d.projects[projectID])}

	active := map[int64]bool{}
	for _, l := range d.lists {
		if l.BoardID == b.ID && l.ArchivedAt == nil {
			snap.Lists = append(snap.Lists, cloneList(l))
			active[l.ID] = true
		}
	}
	sort.Slice(snap.Lists, func(i, j int) bool { return snap.Lists[i].Position < snap.Lists[j].Position })

	for _, c := range d.cards {
		if c.ArchivedAt == nil && active[c.ListID] {
			snap.Cards = append(snap.Cards, d.summary(c))
		}
	}
	sortSummaries(snap.Cards)

	for _, l := range d.labels {
		if l.ProjectID == projectID {
			snap.Labels = append(snap.Labels, l)
		}
	}
	sort.Slice(snap.Labels, func(i, j int) bool { return snap.Labels[i].ID < snap.Labels[j].ID })

	want := map[int64]bool{}
	for _, m := range d.members {
		if m.ProjectID == projectID {
			snap.Members = append(snap.Members, m)
			want[m.UserID] = true
		}
	}
	sort.Slice(snap.Members, func(i, j int) bool {
		a, c := snap.Members[i], snap.Members[j]
		if !a.AddedAt.Equal(c.AddedAt) {
			return a.AddedAt.Before(c.AddedAt)
		}
		return a.UserID < c.UserID
	})
	for _, c := range snap.Cards {
		for _, id := range c.AssigneeIDs {
			want[id] = true
		}
	}
	for id := range want {
		if u, ok := d.userCache[id]; ok {
			snap.Users = append(snap.Users, u)
		}
	}
	sort.Slice(snap.Users, func(i, j int) bool { return snap.Users[i].UserID < snap.Users[j].UserID })
	return snap, nil
}

// summary builds the board view of a card by scanning the child maps; fine for
// the in-memory store, where there is no query cost to avoid.
func (d *data) summary(c store.Card) store.CardSummary {
	s := store.CardSummary{
		ID: c.ID, ListID: c.ListID, Title: c.Title, Priority: c.Priority,
		StartDate: ptr(c.StartDate), DueDate: ptr(c.DueDate), Position: c.Position,
		CompletedAt: ptr(c.CompletedAt), ArchivedAt: ptr(c.ArchivedAt), UpdatedAt: c.UpdatedAt,
		LabelIDs: []int64{}, AssigneeIDs: []int64{},
	}
	for k := range d.cardAssignees {
		if k.CardID == c.ID {
			s.AssigneeIDs = append(s.AssigneeIDs, k.UserID)
		}
	}
	for k := range d.cardLabels {
		if k.CardID == c.ID {
			s.LabelIDs = append(s.LabelIDs, k.LabelID)
		}
	}
	sortIDs(s.AssigneeIDs)
	sortIDs(s.LabelIDs)
	for _, it := range d.checklist {
		if it.CardID == c.ID {
			s.ChecklistTotal++
			if it.IsDone {
				s.ChecklistDone++
			}
		}
	}
	for _, cm := range d.comments {
		if cm.CardID == c.ID && cm.DeletedAt == nil {
			s.CommentCount++
		}
	}
	return s
}

func sortIDs(ids []int64) { sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) }

func sortSummaries(cs []store.CardSummary) {
	sort.Slice(cs, func(i, j int) bool {
		if cs[i].Position != cs[j].Position {
			return cs[i].Position < cs[j].Position
		}
		return cs[i].ID < cs[j].ID
	})
}

type listRepo struct{ d *data }

func (r *listRepo) Create(_ context.Context, l store.List) (store.List, error) {
	l.ID = r.d.nextID("lists")
	r.d.lists[l.ID] = cloneList(l)
	return cloneList(l), nil
}

func (r *listRepo) ByBoard(_ context.Context, boardID int64) ([]store.List, error) {
	out := []store.List{}
	for _, l := range r.d.lists {
		if l.BoardID == boardID {
			out = append(out, cloneList(l))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (r *listRepo) Get(_ context.Context, id int64) (store.List, error) {
	l, ok := r.d.lists[id]
	if !ok {
		return store.List{}, store.ErrNotFound
	}
	return cloneList(l), nil
}

func (r *listRepo) Save(_ context.Context, l store.List) error {
	if _, ok := r.d.lists[l.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.lists[l.ID] = cloneList(l)
	return nil
}

// Lock needs no work here: Update already holds the store's write lock.
func (r *boardRepo) Lock(_ context.Context, boardID int64) error {
	if _, ok := r.d.boards[boardID]; !ok {
		return store.ErrNotFound
	}
	return nil
}

func (r *listRepo) Positions(ctx context.Context, boardID int64) ([]store.IDPos, error) {
	ls, _ := r.ByBoard(ctx, boardID)
	out := make([]store.IDPos, len(ls))
	for i, l := range ls {
		out[i] = store.IDPos{ID: l.ID, Position: l.Position, Archived: l.ArchivedAt != nil}
	}
	return out, nil
}

func (r *listRepo) SetPositions(_ context.Context, ps []store.IDPos) error {
	for _, p := range ps {
		l, ok := r.d.lists[p.ID]
		if !ok {
			return store.ErrNotFound
		}
		l.Position = p.Position
		r.d.lists[p.ID] = l
	}
	return nil
}

func (r *listRepo) Archived(ctx context.Context, boardID int64) ([]store.List, []store.CardSummary, error) {
	ls, _ := r.ByBoard(ctx, boardID)
	lists := []store.List{}
	for _, l := range ls {
		if l.ArchivedAt != nil {
			lists = append(lists, l)
		}
	}
	cards := []store.CardSummary{}
	for _, c := range r.d.cards {
		if c.ArchivedAt != nil && r.d.lists[c.ListID].BoardID == boardID {
			cards = append(cards, r.d.summary(c))
		}
	}
	sortSummaries(cards)
	return lists, cards, nil
}

type cardRepo struct{ d *data }

func (r *cardRepo) Create(_ context.Context, c store.Card) (store.Card, error) {
	c.ID = r.d.nextID("cards")
	r.d.cards[c.ID] = cloneCard(c)
	return cloneCard(c), nil
}

func (r *cardRepo) Get(_ context.Context, id int64) (store.Card, error) {
	c, ok := r.d.cards[id]
	if !ok {
		return store.Card{}, store.ErrNotFound
	}
	return cloneCard(c), nil
}

func (r *cardRepo) Save(_ context.Context, c store.Card) error {
	if _, ok := r.d.cards[c.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.cards[c.ID] = cloneCard(c)
	return nil
}

func (r *cardRepo) SetCompletedForList(_ context.Context, listID int64, at *time.Time) error {
	for id, c := range r.d.cards {
		if c.ListID != listID || c.ArchivedAt != nil {
			continue
		}
		switch {
		case at != nil && c.CompletedAt == nil:
			c.CompletedAt = ptr(at)
		case at == nil:
			c.CompletedAt = nil
		default:
			continue
		}
		r.d.cards[id] = c
	}
	return nil
}
