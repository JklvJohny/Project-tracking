package dashboard

import (
	"sort"
	"time"

	"tracking-service/internal/store"
)

type Totals struct {
	Total      int `json:"total"`
	Done       int `json:"done"`
	Open       int `json:"open"`
	InProgress int `json:"inProgress"`
	NotStarted int `json:"notStarted"`
	Overdue    int `json:"overdue"`
	DueSoon    int `json:"dueSoon"`
	Unassigned int `json:"unassigned"`
}

type View struct {
	AsOf       string          `json:"asOf"`
	Totals     Totals          `json:"totals"`
	ByProject  []ProjectBar    `json:"byProject"`
	Workload   []PersonLoad    `json:"workload"`
	ByPriority []PriorityCount `json:"byPriority"`
	Deadlines  []Deadline      `json:"deadlines"`
}

type ProjectBar struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Done       int    `json:"done"`
	InProgress int    `json:"inProgress"`
	NotStarted int    `json:"notStarted"`
	Overdue    int    `json:"overdue"`
	Total      int    `json:"total"`
}

type UserView struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type PersonLoad struct {
	User       UserView `json:"user"`
	InProgress int      `json:"inProgress"`
	NotStarted int      `json:"notStarted"`
	Overdue    int      `json:"overdue"`
	Open       int      `json:"open"`
}

type PriorityCount struct {
	Priority string `json:"priority"`
	Open     int    `json:"open"`
}

type Deadline struct {
	CardID      int64      `json:"cardId"`
	ProjectID   int64      `json:"projectId"`
	ProjectName string     `json:"projectName"`
	ListName    string     `json:"listName"`
	Title       string     `json:"title"`
	DueDate     string     `json:"dueDate"`
	DaysLeft    int        `json:"daysLeft"`
	Assignees   []UserView `json:"assignees"`
}

const (
	dueSoonDays     = 7
	deadlineHorizon = 14
	maxDeadlines    = 20
)

// priorityOrder is the API order of byPriority; the numbers are store priorities.
var priorityOrder = [...]int16{3, 2, 1, 0}

type status int

const (
	statusDone status = iota
	statusOverdue
	statusInProgress
	statusNotStarted
)

// classify applies the same rules as the Timeline: done, then overdue, then in
// progress, else not started. Dates are YYYY-MM-DD, so string order is date order.
func classify(r store.DashboardRow, today store.Date) status {
	switch {
	case r.CompletedAt != nil:
		return statusDone
	case r.DueDate != nil && *r.DueDate < today:
		return statusOverdue
	case r.StartDate != nil && *r.StartDate <= today:
		return statusInProgress
	}
	return statusNotStarted
}

// daysBetween is due minus today in whole calendar days; both are plain dates,
// so UTC parsing has no DST or zone effect.
func daysBetween(due, today store.Date) int {
	d, err1 := time.Parse(time.DateOnly, string(due))
	t, err2 := time.Parse(time.DateOnly, string(today))
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(d.Sub(t).Hours() / 24)
}

func userView(id int64, users map[int64]store.CachedUser) UserView {
	u := users[id]
	return UserView{ID: id, Name: u.DisplayName, AvatarURL: u.AvatarURL}
}

// Build aggregates the dashboard from active cards. It is pure: the caller
// supplies the rows, the members of the scoped projects, the cached profiles
// and today's date in the business zone.
func Build(rows []store.DashboardRow, members []store.Member, users map[int64]store.CachedUser, today store.Date) View {
	v := View{
		AsOf:       string(today),
		ByProject:  []ProjectBar{},
		Workload:   []PersonLoad{},
		ByPriority: make([]PriorityCount, len(priorityOrder)),
		Deadlines:  []Deadline{},
	}
	for i, p := range priorityOrder {
		v.ByPriority[i].Priority = store.PriorityName(p)
	}

	projects := map[int64]*ProjectBar{}
	load := map[int64]*PersonLoad{}
	for _, m := range members {
		if _, ok := load[m.UserID]; !ok {
			load[m.UserID] = &PersonLoad{User: userView(m.UserID, users)}
		}
	}

	for _, r := range rows {
		st := classify(r, today)
		pb := projects[r.ProjectID]
		if pb == nil {
			pb = &ProjectBar{ID: r.ProjectID, Name: r.ProjectName}
			projects[r.ProjectID] = pb
		}
		pb.Total++
		v.Totals.Total++
		switch st {
		case statusDone:
			pb.Done++
			v.Totals.Done++
			continue
		case statusOverdue:
			pb.Overdue++
			v.Totals.Overdue++
		case statusInProgress:
			pb.InProgress++
			v.Totals.InProgress++
		case statusNotStarted:
			pb.NotStarted++
			v.Totals.NotStarted++
		}
		v.Totals.Open++
		if len(r.AssigneeIDs) == 0 {
			v.Totals.Unassigned++
		}
		for _, id := range r.AssigneeIDs {
			pl := load[id]
			if pl == nil {
				continue // not a member of the scoped projects
			}
			pl.Open++
			switch st {
			case statusOverdue:
				pl.Overdue++
			case statusInProgress:
				pl.InProgress++
			case statusNotStarted:
				pl.NotStarted++
			}
		}
		for i, p := range priorityOrder {
			if r.Priority == p {
				v.ByPriority[i].Open++
			}
		}
		if r.DueDate != nil {
			left := daysBetween(*r.DueDate, today)
			if left >= 0 && left <= dueSoonDays {
				v.Totals.DueSoon++
			}
			if left <= deadlineHorizon {
				as := make([]UserView, len(r.AssigneeIDs))
				for i, id := range r.AssigneeIDs {
					as[i] = userView(id, users)
				}
				v.Deadlines = append(v.Deadlines, Deadline{
					CardID: r.CardID, ProjectID: r.ProjectID, ProjectName: r.ProjectName, ListName: r.ListName,
					Title: r.Title, DueDate: string(*r.DueDate), DaysLeft: left, Assignees: as,
				})
			}
		}
	}

	for _, pb := range projects {
		v.ByProject = append(v.ByProject, *pb)
	}
	sort.Slice(v.ByProject, func(i, j int) bool {
		a, b := v.ByProject[i], v.ByProject[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.ID < b.ID
	})
	for _, pl := range load {
		v.Workload = append(v.Workload, *pl)
	}
	sort.Slice(v.Workload, func(i, j int) bool {
		a, b := v.Workload[i], v.Workload[j]
		if a.Open != b.Open {
			return a.Open > b.Open
		}
		if a.User.Name != b.User.Name {
			return a.User.Name < b.User.Name
		}
		return a.User.ID < b.User.ID
	})
	sort.Slice(v.Deadlines, func(i, j int) bool {
		a, b := v.Deadlines[i], v.Deadlines[j]
		if a.DueDate != b.DueDate {
			return a.DueDate < b.DueDate
		}
		return a.CardID < b.CardID
	})
	if len(v.Deadlines) > maxDeadlines {
		v.Deadlines = v.Deadlines[:maxDeadlines]
	}
	return v
}
