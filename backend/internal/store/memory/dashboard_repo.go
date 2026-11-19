package memory

import (
	"context"
	"slices"
	"sort"

	"tracking-service/internal/store"
)

type dashboardRepo struct{ d *data }

func (r *dashboardRepo) Rows(_ context.Context, projectIDs []int64) ([]store.DashboardRow, error) {
	d := r.d
	want := make(map[int64]bool, len(projectIDs))
	for _, id := range projectIDs {
		want[id] = true
	}
	assignees := map[int64][]int64{}
	for k := range d.cardAssignees {
		assignees[k.CardID] = append(assignees[k.CardID], k.UserID)
	}
	out := []store.DashboardRow{}
	for _, c := range d.cards {
		l, ok := d.lists[c.ListID]
		if !ok || c.ArchivedAt != nil || l.ArchivedAt != nil {
			continue
		}
		b, ok := d.boards[l.BoardID]
		if !ok || !want[b.ProjectID] {
			continue
		}
		p, ok := d.projects[b.ProjectID]
		if !ok || p.ArchivedAt != nil {
			continue
		}
		ids := slices.Clone(assignees[c.ID])
		if ids == nil {
			ids = []int64{}
		}
		slices.Sort(ids)
		out = append(out, store.DashboardRow{
			CardID: c.ID, ProjectID: p.ID, ProjectName: p.Name, ListName: l.Name,
			Title: c.Title, Priority: c.Priority, StartDate: ptr(c.StartDate), DueDate: ptr(c.DueDate),
			CompletedAt: ptr(c.CompletedAt), AssigneeIDs: ids,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ProjectID != out[j].ProjectID {
			return out[i].ProjectID < out[j].ProjectID
		}
		return out[i].CardID < out[j].CardID
	})
	return out, nil
}

func (r *dashboardRepo) AssignedTo(ctx context.Context, userID int64, projectIDs []int64) ([]store.TaskRow, error) {
	rows, err := r.Rows(ctx, projectIDs)
	if err != nil {
		return nil, err
	}
	total, done := map[int64]int{}, map[int64]int{}
	for _, it := range r.d.checklist {
		total[it.CardID]++
		if it.IsDone {
			done[it.CardID]++
		}
	}
	out := []store.TaskRow{}
	for _, row := range rows {
		if row.CompletedAt == nil && slices.Contains(row.AssigneeIDs, userID) {
			out = append(out, store.TaskRow{DashboardRow: row, ChecklistTotal: total[row.CardID], ChecklistDone: done[row.CardID]})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].DueDate, out[j].DueDate
		if (a == nil) != (b == nil) {
			return b == nil
		}
		if a != nil && *a != *b {
			return *a < *b
		}
		return out[i].CardID < out[j].CardID
	})
	return out, nil
}
