package memory

import (
	"context"
	"sort"
	"strings"

	"tracking-service/internal/store"
)

type projectRepo struct{ d *data }

func (r *projectRepo) Create(_ context.Context, p store.Project) (store.Project, error) {
	p.ID = r.d.nextID("projects")
	r.d.projects[p.ID] = cloneProject(p)
	return cloneProject(p), nil
}

func (r *projectRepo) Get(_ context.Context, id int64) (store.Project, error) {
	p, ok := r.d.projects[id]
	if !ok {
		return store.Project{}, store.ErrNotFound
	}
	return cloneProject(p), nil
}

func (r *projectRepo) Save(_ context.Context, p store.Project) error {
	if _, ok := r.d.projects[p.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.projects[p.ID] = cloneProject(p)
	return nil
}

func (r *projectRepo) All(_ context.Context) ([]store.Project, error) {
	return r.collect(func(store.Project) bool { return true }), nil
}

func (r *projectRepo) ByMember(_ context.Context, userID int64) ([]store.Project, error) {
	return r.collect(func(p store.Project) bool {
		_, ok := r.d.members[memberKey{p.ID, userID}]
		return ok
	}), nil
}

func (r *projectRepo) collect(keep func(store.Project) bool) []store.Project {
	out := []store.Project{}
	for _, p := range r.d.projects {
		if keep(p) {
			out = append(out, cloneProject(p))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (r *projectRepo) NameTaken(_ context.Context, name string, exceptID int64) (bool, error) {
	for _, p := range r.d.projects {
		if p.ID != exceptID && p.ArchivedAt == nil && strings.EqualFold(p.Name, name) {
			return true, nil
		}
	}
	return false, nil
}

type memberRepo struct{ d *data }

func (r *memberRepo) Get(_ context.Context, projectID, userID int64) (store.Member, error) {
	m, ok := r.d.members[memberKey{projectID, userID}]
	if !ok {
		return store.Member{}, store.ErrNotFound
	}
	return m, nil
}

func (r *memberRepo) List(_ context.Context, projectID int64) ([]store.Member, error) {
	out := []store.Member{}
	for _, m := range r.d.members {
		if m.ProjectID == projectID {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].AddedAt.Equal(out[j].AddedAt) {
			return out[i].AddedAt.Before(out[j].AddedAt)
		}
		return out[i].UserID < out[j].UserID
	})
	return out, nil
}

func (r *memberRepo) Put(_ context.Context, m store.Member) error {
	r.d.members[memberKey{m.ProjectID, m.UserID}] = m
	return nil
}

func (r *memberRepo) Delete(_ context.Context, projectID, userID int64) error {
	k := memberKey{projectID, userID}
	if _, ok := r.d.members[k]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.members, k)
	return nil
}

func (r *memberRepo) CountPM(_ context.Context, projectID int64) (int, error) {
	n := 0
	for _, m := range r.d.members {
		if m.ProjectID == projectID && m.Role == "pm" {
			n++
		}
	}
	return n, nil
}
