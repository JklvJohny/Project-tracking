// Package dashboard serves the one-page overview of open work across the
// projects the caller can see.
package dashboard

import (
	"context"
	"errors"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

// bangkok is the business zone ("today" is a Bangkok date). The fixed zone is
// the fallback for hosts without tzdata; Thailand has no DST.
var bangkok = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*60*60)
}()

type Service struct {
	st  store.Store
	now clock.Clock
}

func New(st store.Store, now clock.Clock) *Service { return &Service{st: st, now: now} }

// Get builds the dashboard for the caller. projectID narrows it to one project;
// a project the caller cannot see (or an archived one) is not_found.
func (s *Service) Get(ctx context.Context, userID int64, projectID *int64) (View, error) {
	today := store.Date(s.now().In(bangkok).Format(time.DateOnly))
	var out View
	err := s.st.View(ctx, func(r store.Repos) error {
		ps, err := scope(ctx, r, userID, projectID)
		if err != nil {
			return err
		}
		ids := make([]int64, len(ps))
		for i, p := range ps {
			ids[i] = p.ID
		}
		rows, err := r.Dashboard.Rows(ctx, ids)
		if err != nil {
			return err
		}
		sums, err := r.Projects.Summaries(ctx, ids)
		if err != nil {
			return err
		}
		var members []store.Member
		for _, id := range ids {
			members = append(members, sums[id].Members...)
		}
		userIDs := profileIDs(rows, members)
		cached, err := r.Users.Get(ctx, userIDs)
		if err != nil {
			return err
		}
		users := make(map[int64]store.CachedUser, len(cached))
		for _, u := range cached {
			users[u.UserID] = u
		}
		out = Build(rows, ps, members, users, today)
		return nil
	})
	return out, err
}

// scope resolves the non-archived projects the caller may view.
func scope(ctx context.Context, r store.Repos, userID int64, projectID *int64) ([]store.Project, error) {
	if projectID != nil {
		role, err := authz.ProjectRole(ctx, r, userID, *projectID)
		if err != nil {
			return nil, err
		}
		if err := authz.Require(role, authz.View); err != nil {
			return nil, err
		}
		p, err := r.Projects.Get(ctx, *projectID)
		if err != nil {
			return nil, notFound(err)
		}
		if p.ArchivedAt != nil {
			return nil, apperr.NotFound("project")
		}
		return []store.Project{p}, nil
	}
	ur, err := r.UserRoles.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	var ps []store.Project
	if ur != nil && ur.Role == "admin" {
		ps, err = r.Projects.All(ctx)
	} else {
		ps, err = r.Projects.ByMember(ctx, userID)
	}
	if err != nil {
		return nil, err
	}
	active := make([]store.Project, 0, len(ps))
	for _, p := range ps {
		if p.ArchivedAt == nil {
			active = append(active, p)
		}
	}
	return active, nil
}

func notFound(err error) error {
	if errors.Is(err, store.ErrNotFound) {
		return apperr.NotFound("project")
	}
	return err
}

// profileIDs lists each assignee and member once, for a single user_cache read.
func profileIDs(rows []store.DashboardRow, members []store.Member) []int64 {
	seen := map[int64]bool{}
	var ids []int64
	add := func(id int64) {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, m := range members {
		add(m.UserID)
	}
	for _, r := range rows {
		for _, id := range r.AssigneeIDs {
			add(id)
		}
	}
	return ids
}
