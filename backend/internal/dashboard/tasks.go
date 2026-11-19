package dashboard

import (
	"context"
	"time"

	"tracking-service/internal/store"
)

// Task is one open card assigned to the caller.
type Task struct {
	CardID         int64      `json:"cardId"`
	ProjectID      int64      `json:"projectId"`
	ProjectName    string     `json:"projectName"`
	ListName       string     `json:"listName"`
	Title          string     `json:"title"`
	Priority       string     `json:"priority"`
	StartDate      *string    `json:"startDate"`
	DueDate        *string    `json:"dueDate"`
	DaysLeft       *int       `json:"daysLeft"`
	ChecklistTotal int        `json:"checklistTotal"`
	ChecklistDone  int        `json:"checklistDone"`
	Assignees      []UserView `json:"assignees"`
}

// MyTasks is the caller's open work across every project they can see.
type MyTasks struct {
	AsOf  string `json:"asOf"`
	Tasks []Task `json:"tasks"`
}

// MyTasks lists the caller's open cards in the non-archived projects they can
// see, earliest due date first (no due date last). DaysLeft is counted from
// today in Bangkok so the client groups by the same calendar as the dashboard.
func (s *Service) MyTasks(ctx context.Context, userID int64) (MyTasks, error) {
	today := store.Date(s.now().In(bangkok).Format(time.DateOnly))
	out := MyTasks{AsOf: string(today), Tasks: []Task{}}
	err := s.st.View(ctx, func(r store.Repos) error {
		ps, err := scope(ctx, r, userID, nil)
		if err != nil {
			return err
		}
		ids := make([]int64, len(ps))
		for i, p := range ps {
			ids[i] = p.ID
		}
		rows, err := r.Dashboard.AssignedTo(ctx, userID, ids)
		if err != nil {
			return err
		}
		seen := map[int64]bool{}
		var userIDs []int64
		for _, row := range rows {
			for _, id := range row.AssigneeIDs {
				if !seen[id] {
					seen[id] = true
					userIDs = append(userIDs, id)
				}
			}
		}
		cached, err := r.Users.Get(ctx, userIDs)
		if err != nil {
			return err
		}
		users := make(map[int64]store.CachedUser, len(cached))
		for _, u := range cached {
			users[u.UserID] = u
		}
		for _, row := range rows {
			t := Task{
				CardID: row.CardID, ProjectID: row.ProjectID, ProjectName: row.ProjectName, ListName: row.ListName,
				Title: row.Title, Priority: store.PriorityName(row.Priority),
				StartDate: dateStr(row.StartDate), DueDate: dateStr(row.DueDate),
				ChecklistTotal: row.ChecklistTotal, ChecklistDone: row.ChecklistDone,
				Assignees: make([]UserView, len(row.AssigneeIDs)),
			}
			if row.DueDate != nil {
				left := daysBetween(*row.DueDate, today)
				t.DaysLeft = &left
			}
			for i, id := range row.AssigneeIDs {
				t.Assignees[i] = userView(id, users)
			}
			out.Tasks = append(out.Tasks, t)
		}
		return nil
	})
	return out, err
}

func dateStr(d *store.Date) *string {
	if d == nil {
		return nil
	}
	s := string(*d)
	return &s
}
