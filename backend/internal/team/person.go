package team

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/dashboard"
	"tracking-service/internal/store"
)

// PersonProject is one live project the person belongs to, with their role
// there and how many of its open cards are theirs.
type PersonProject struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Role   string `json:"role"`
	Open   int    `json:"open"`
}

// PersonView is one person's page: who they are, where they work and every
// open card assigned to them, so a PM can see what a new card would collide
// with.
type PersonView struct {
	AsOf     string           `json:"asOf"`
	Person   Person           `json:"person"`
	Projects []PersonProject  `json:"projects"`
	Tasks    []dashboard.Task `json:"tasks"`
}

// Person returns userID's page for caller. Admins and anyone who is PM of a
// project may open anyone's (authz.CanViewPeople), across every live project;
// others only their own. The counts follow the Team page's rules.
func (s *Service) Person(ctx context.Context, caller, userID int64) (PersonView, error) {
	found, err := s.up.Get(ctx, []int64{userID})
	if err != nil {
		return PersonView{}, err
	}
	if len(found) == 0 {
		return PersonView{}, apperr.NotFound("user")
	}
	u := found[0]
	now := s.now().In(bangkok)
	today := store.Date(now.Format(time.DateOnly))
	// "Due in 7 days" is today through today+7, as on the dashboard; soon is the
	// first day after it (the repo bound is exclusive).
	soon := store.Date(now.AddDate(0, 0, soonDays+1).Format(time.DateOnly))
	out := PersonView{
		AsOf:     string(today),
		Person:   Person{UserID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL, Skills: []string{}},
		Projects: []PersonProject{},
		Tasks:    []dashboard.Task{},
	}
	err = s.st.View(ctx, func(r store.Repos) error {
		if caller != userID {
			ok, err := authz.CanViewPeople(ctx, r, caller)
			if err != nil {
				return err
			}
			if !ok {
				return apperr.Forbidden()
			}
		}
		ps, err := r.Projects.ByMember(ctx, userID)
		if err != nil {
			return err
		}
		var ids []int64
		for _, p := range ps {
			if p.ArchivedAt != nil {
				continue
			}
			m, err := r.Members.Get(ctx, p.ID, userID)
			if errors.Is(err, store.ErrNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			ids = append(ids, p.ID)
			out.Projects = append(out.Projects, PersonProject{ID: p.ID, Name: p.Name, Status: p.Status, Role: m.Role})
		}
		rows, err := r.Dashboard.AssignedTo(ctx, userID, ids)
		if err != nil {
			return err
		}
		if out.Tasks, err = dashboard.BuildTasks(ctx, r, rows, today); err != nil {
			return err
		}
		open := map[int64]int{}
		for _, row := range rows {
			open[row.ProjectID]++
			out.Person.Open++
			switch {
			case row.DueDate == nil:
			case *row.DueDate < today:
				out.Person.Overdue++
			case *row.DueDate < soon:
				out.Person.DueSoon++
			}
		}
		for i := range out.Projects {
			out.Projects[i].Open = open[out.Projects[i].ID]
		}
		skills, err := r.Team.Skills(ctx)
		if err != nil {
			return err
		}
		if sk := skills[userID]; sk != nil {
			out.Person.Skills = sk
		}
		return nil
	})
	if err != nil {
		return PersonView{}, err
	}
	sort.SliceStable(out.Projects, func(i, j int) bool {
		return strings.ToLower(out.Projects[i].Name) < strings.ToLower(out.Projects[j].Name)
	})
	return out, nil
}
