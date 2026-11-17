// Package project holds projects, their members, and the caller's identity
// (/me, /users). Permission checks live in authz; this package applies them.
package project

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"
	"unicode/utf8"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/rank"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
	"tracking-service/internal/validate"
)

const (
	maxName        = 200
	maxDescription = 20000
	maxSearch      = 20
	refreshBatch   = 200
)

var listNames = map[string][4]string{
	"th": {"สิ่งที่ต้องทำ", "กำลังทำ", "รอตรวจ", "เสร็จแล้ว"},
	"en": {"To Do", "In Progress", "Review", "Done"},
}

type Service struct {
	st  store.Store
	up  users.Provider
	ev  events.Publisher // reserved: project events are not published yet
	now clock.Clock
}

func New(st store.Store, up users.Provider, ev events.Publisher, now clock.Clock) *Service {
	return &Service{st: st, up: up, ev: ev, now: now}
}

type ProjectView struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	OwnerID     int64      `json:"ownerId"`
	Status      string     `json:"status"`
	StartDate   *string    `json:"startDate"`
	EndDate     *string    `json:"endDate"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ArchivedAt  *time.Time `json:"archivedAt"`
	MyRole      string     `json:"myRole"`
}

type MemberView struct {
	UserID    int64     `json:"userId"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl"`
	Role      string    `json:"role"`
	AddedAt   time.Time `json:"addedAt"`
}

type UserView struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type MeView struct {
	User             UserView `json:"user"`
	IsAdmin          bool     `json:"isAdmin"`
	CanCreateProject bool     `json:"canCreateProject"`
}

type CreateProjectInput struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Lang        string  `json:"lang"` // th | en; empty means en
	StartDate   *string `json:"startDate"`
	EndDate     *string `json:"endDate"`
}

// UpdateProjectInput is a partial update: nil leaves a field alone. An empty
// string clears startDate or endDate.
type UpdateProjectInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	StartDate   *string `json:"startDate"`
	EndDate     *string `json:"endDate"`
}

func view(p store.Project, role authz.Role) ProjectView {
	v := ProjectView{
		ID: p.ID, Name: p.Name, Description: p.Description, OwnerID: p.OwnerID, Status: p.Status,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, ArchivedAt: p.ArchivedAt, MyRole: string(role),
	}
	if p.StartDate != nil {
		s := string(*p.StartDate)
		v.StartDate = &s
	}
	if p.EndDate != nil {
		s := string(*p.EndDate)
		v.EndDate = &s
	}
	return v
}

// load resolves the project and the caller's role; a non-member gets not_found
// before the project is even read.
func load(ctx context.Context, r store.Repos, userID, id int64) (store.Project, authz.Role, error) {
	role, err := authz.ProjectRole(ctx, r, userID, id)
	if err != nil {
		return store.Project{}, "", err
	}
	p, err := r.Projects.Get(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return store.Project{}, "", apperr.NotFound("project")
	}
	return p, role, err
}

// loadManaged is load plus the ManageProject check.
func loadManaged(ctx context.Context, r store.Repos, userID, id int64) (store.Project, authz.Role, error) {
	p, role, err := load(ctx, r, userID, id)
	if err != nil {
		return p, role, err
	}
	return p, role, authz.Require(role, authz.ManageProject)
}

func (s *Service) record(ctx context.Context, r store.Repos, projectID, actor int64, typ string, payload map[string]any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return r.Activity.Append(ctx, store.ActivityEvent{ProjectID: projectID, ActorID: actor, Type: typ, Payload: b, CreatedAt: s.now()})
}

func (s *Service) touchBoard(ctx context.Context, r store.Repos, projectID int64) error {
	b, err := r.Boards.ByProject(ctx, projectID)
	if err != nil {
		return err
	}
	return r.Boards.Touch(ctx, b.ID, s.now())
}

func checkDescription(d string, fields map[string]string) {
	if utf8.RuneCountInString(d) > maxDescription {
		fields["description"] = "too_long"
	}
}

func (s *Service) List(ctx context.Context, userID int64) ([]ProjectView, error) {
	var out []ProjectView
	err := s.st.View(ctx, func(r store.Repos) error {
		ur, err := r.UserRoles.Get(ctx, userID)
		if err != nil {
			return err
		}
		isAdmin := ur != nil && ur.Role == "admin"
		var ps []store.Project
		if isAdmin {
			ps, err = r.Projects.All(ctx)
		} else {
			ps, err = r.Projects.ByMember(ctx, userID)
		}
		if err != nil {
			return err
		}
		out = make([]ProjectView, 0, len(ps))
		for _, p := range ps {
			role := authz.Admin
			if !isAdmin {
				m, err := r.Members.Get(ctx, p.ID, userID)
				if err != nil {
					return err
				}
				role = authz.Role(m.Role)
			}
			out = append(out, view(p, role))
		}
		// Active projects first, then the most recently changed.
		sort.SliceStable(out, func(i, j int) bool {
			ai, aj := out[i].ArchivedAt != nil, out[j].ArchivedAt != nil
			if ai != aj {
				return !ai
			}
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		})
		return nil
	})
	return out, err
}

func (s *Service) Create(ctx context.Context, userID int64, in CreateProjectInput) (ProjectView, error) {
	var out ProjectView
	err := s.st.Update(ctx, func(r store.Repos) error {
		ur, err := r.UserRoles.Get(ctx, userID)
		if err != nil {
			return err
		}
		if !authz.CanCreateProject(ur) {
			return apperr.Forbidden()
		}
		fields := map[string]string{}
		name := validate.Text("name", in.Name, maxName, fields)
		checkDescription(in.Description, fields)
		lang := in.Lang
		if lang == "" {
			lang = "en"
		}
		names, ok := listNames[lang]
		if !ok {
			fields["lang"] = "invalid"
		}
		start := validate.Date("startDate", in.StartDate, fields)
		end := validate.Date("endDate", in.EndDate, fields)
		validate.DateOrder("endDate", start, end, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		if taken, err := r.Projects.NameTaken(ctx, name, 0); err != nil {
			return err
		} else if taken {
			return apperr.Conflict("project name already in use")
		}

		now := s.now()
		p, err := r.Projects.Create(ctx, store.Project{
			Name: name, Description: in.Description, OwnerID: userID, Status: "active",
			StartDate: start, EndDate: end, CreatedBy: userID, CreatedAt: now, UpdatedAt: now,
		})
		if err != nil {
			return err
		}
		b, err := r.Boards.Create(ctx, store.Board{ProjectID: p.ID, UpdatedAt: now})
		if err != nil {
			return err
		}
		for i, pos := range rank.Spread(len(names)) {
			if _, err := r.Lists.Create(ctx, store.List{
				BoardID: b.ID, Name: names[i], Position: pos, IsDone: i == len(names)-1, CreatedAt: now, UpdatedAt: now,
			}); err != nil {
				return err
			}
		}
		if err := r.Members.Put(ctx, store.Member{ProjectID: p.ID, UserID: userID, Role: "pm", AddedAt: now}); err != nil {
			return err
		}
		if err := s.cacheUsers(ctx, r, userID); err != nil {
			return err
		}
		if err := s.record(ctx, r, p.ID, userID, "project.created", map[string]any{"projectId": p.ID}); err != nil {
			return err
		}
		out = view(p, authz.PM)
		return nil
	})
	return out, err
}

func (s *Service) Get(ctx context.Context, userID, id int64) (ProjectView, error) {
	var out ProjectView
	err := s.st.View(ctx, func(r store.Repos) error {
		p, role, err := load(ctx, r, userID, id)
		out = view(p, role)
		return err
	})
	return out, err
}

func (s *Service) Update(ctx context.Context, userID, id int64, in UpdateProjectInput) (ProjectView, error) {
	var out ProjectView
	err := s.st.Update(ctx, func(r store.Repos) error {
		p, role, err := loadManaged(ctx, r, userID, id)
		if err != nil {
			return err
		}
		fields := map[string]string{}
		var changed []string
		if in.Name != nil {
			p.Name = validate.Text("name", *in.Name, maxName, fields)
			changed = append(changed, "name")
		}
		if in.Description != nil {
			checkDescription(*in.Description, fields)
			p.Description = *in.Description
			changed = append(changed, "description")
		}
		if in.Status != nil {
			switch *in.Status {
			case "active", "on_hold", "done":
				p.Status = *in.Status
			default:
				fields["status"] = "invalid"
			}
			changed = append(changed, "status")
		}
		if in.StartDate != nil {
			p.StartDate = dateOrClear("startDate", *in.StartDate, fields)
			changed = append(changed, "startDate")
		}
		if in.EndDate != nil {
			p.EndDate = dateOrClear("endDate", *in.EndDate, fields)
			changed = append(changed, "endDate")
		}
		if len(fields) == 0 {
			validate.DateOrder("endDate", p.StartDate, p.EndDate, fields)
		}
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		if in.Name != nil && p.ArchivedAt == nil {
			if taken, err := r.Projects.NameTaken(ctx, p.Name, p.ID); err != nil {
				return err
			} else if taken {
				return apperr.Conflict("project name already in use")
			}
		}
		p.UpdatedAt = s.now()
		if err := r.Projects.Save(ctx, p); err != nil {
			return err
		}
		if err := s.record(ctx, r, p.ID, userID, "project.updated", map[string]any{"fields": changed}); err != nil {
			return err
		}
		out = view(p, role)
		return nil
	})
	return out, err
}

func dateOrClear(field, v string, fields map[string]string) *store.Date {
	if v == "" {
		return nil
	}
	return validate.Date(field, &v, fields)
}

// Archive and Restore are no-ops on a project already in the target state.
func (s *Service) Archive(ctx context.Context, userID, id int64) (ProjectView, error) {
	return s.setArchived(ctx, userID, id, true)
}

func (s *Service) Restore(ctx context.Context, userID, id int64) (ProjectView, error) {
	return s.setArchived(ctx, userID, id, false)
}

func (s *Service) setArchived(ctx context.Context, userID, id int64, archive bool) (ProjectView, error) {
	var out ProjectView
	err := s.st.Update(ctx, func(r store.Repos) error {
		p, role, err := loadManaged(ctx, r, userID, id)
		if err != nil {
			return err
		}
		out = view(p, role)
		if archive == (p.ArchivedAt != nil) {
			return nil
		}
		typ := "project.archived"
		if archive {
			now := s.now()
			p.ArchivedAt = &now
		} else {
			typ = "project.restored"
			p.ArchivedAt = nil
			if taken, err := r.Projects.NameTaken(ctx, p.Name, p.ID); err != nil {
				return err
			} else if taken {
				return apperr.Conflict("project name already in use")
			}
		}
		p.UpdatedAt = s.now()
		if err := r.Projects.Save(ctx, p); err != nil {
			return err
		}
		if err := s.record(ctx, r, p.ID, userID, typ, map[string]any{}); err != nil {
			return err
		}
		out = view(p, role)
		return nil
	})
	return out, err
}

func (s *Service) Members(ctx context.Context, userID, projectID int64) ([]MemberView, error) {
	var out []MemberView
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, _, err := load(ctx, r, userID, projectID); err != nil {
			return err
		}
		ms, err := r.Members.List(ctx, projectID)
		if err != nil {
			return err
		}
		ids := make([]int64, len(ms))
		for i, m := range ms {
			ids[i] = m.UserID
		}
		cached, err := r.Users.Get(ctx, ids)
		if err != nil {
			return err
		}
		byID := make(map[int64]store.CachedUser, len(cached))
		for _, u := range cached {
			byID[u.UserID] = u
		}
		out = make([]MemberView, len(ms))
		for i, m := range ms {
			out[i] = memberView(m, byID[m.UserID])
		}
		return nil
	})
	return out, err
}

func memberView(m store.Member, u store.CachedUser) MemberView {
	return MemberView{UserID: m.UserID, Name: u.DisplayName, AvatarURL: u.AvatarURL, Role: m.Role, AddedAt: m.AddedAt}
}

func validRole(role string, fields map[string]string) {
	switch role {
	case "pm", "member", "viewer":
	default:
		fields["role"] = "invalid"
	}
}

// cacheUsers copies people from user-service into user_cache. Ids user-service
// does not know are skipped.
func (s *Service) cacheUsers(ctx context.Context, r store.Repos, ids ...int64) error {
	found, err := s.up.Get(ctx, ids)
	if err != nil {
		return err
	}
	cu := make([]store.CachedUser, len(found))
	for i, u := range found {
		cu[i] = store.CachedUser{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL}
	}
	return r.Users.Upsert(ctx, cu)
}

func (s *Service) AddMember(ctx context.Context, userID, projectID, memberID int64, role string) (MemberView, error) {
	var out MemberView
	err := s.st.Update(ctx, func(r store.Repos) error {
		if _, _, err := loadManaged(ctx, r, userID, projectID); err != nil {
			return err
		}
		fields := map[string]string{}
		validRole(role, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		found, err := s.up.Get(ctx, []int64{memberID})
		if err != nil {
			return err
		}
		if len(found) == 0 {
			return apperr.NotFound("user")
		}
		if _, err := r.Members.Get(ctx, projectID, memberID); err == nil {
			return apperr.Conflict("already a member")
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err := s.cacheUsers(ctx, r, memberID); err != nil {
			return err
		}
		m := store.Member{ProjectID: projectID, UserID: memberID, Role: role, AddedAt: s.now()}
		if err := r.Members.Put(ctx, m); err != nil {
			return err
		}
		if err := s.touchBoard(ctx, r, projectID); err != nil {
			return err
		}
		if err := s.record(ctx, r, projectID, userID, "member.added", map[string]any{"userId": memberID, "role": role}); err != nil {
			return err
		}
		out = memberView(m, store.CachedUser{UserID: memberID, DisplayName: found[0].Name, AvatarURL: found[0].AvatarURL})
		return nil
	})
	return out, err
}

func (s *Service) SetRole(ctx context.Context, userID, projectID, memberID int64, role string) (MemberView, error) {
	var out MemberView
	err := s.st.Update(ctx, func(r store.Repos) error {
		if _, _, err := loadManaged(ctx, r, userID, projectID); err != nil {
			return err
		}
		fields := map[string]string{}
		validRole(role, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		m, err := r.Members.Get(ctx, projectID, memberID)
		if errors.Is(err, store.ErrNotFound) {
			return apperr.NotFound("member")
		}
		if err != nil {
			return err
		}
		if m.Role == "pm" && role != "pm" {
			if err := keepOnePM(ctx, r, projectID); err != nil {
				return err
			}
		}
		if err := s.cacheUsers(ctx, r, memberID); err != nil {
			return err
		}
		m.Role = role
		if err := r.Members.Put(ctx, m); err != nil {
			return err
		}
		if err := s.touchBoard(ctx, r, projectID); err != nil {
			return err
		}
		if err := s.record(ctx, r, projectID, userID, "member.role_changed", map[string]any{"userId": memberID, "role": role}); err != nil {
			return err
		}
		cached, err := r.Users.Get(ctx, []int64{memberID})
		if err != nil {
			return err
		}
		var cu store.CachedUser
		if len(cached) > 0 {
			cu = cached[0]
		}
		out = memberView(m, cu)
		return nil
	})
	return out, err
}

func (s *Service) RemoveMember(ctx context.Context, userID, projectID, memberID int64) error {
	return s.st.Update(ctx, func(r store.Repos) error {
		if _, _, err := loadManaged(ctx, r, userID, projectID); err != nil {
			return err
		}
		m, err := r.Members.Get(ctx, projectID, memberID)
		if errors.Is(err, store.ErrNotFound) {
			return apperr.NotFound("member")
		}
		if err != nil {
			return err
		}
		if m.Role == "pm" {
			if err := keepOnePM(ctx, r, projectID); err != nil {
				return err
			}
		}
		if err := r.Members.Delete(ctx, projectID, memberID); err != nil {
			return err
		}
		if err := s.touchBoard(ctx, r, projectID); err != nil {
			return err
		}
		return s.record(ctx, r, projectID, userID, "member.removed", map[string]any{"userId": memberID})
	})
}

// keepOnePM refuses a change that would take away the project's only PM. An
// admin who is not a member does not count: CountPM looks at member rows only.
func keepOnePM(ctx context.Context, r store.Repos, projectID int64) error {
	n, err := r.Members.CountPM(ctx, projectID)
	if err != nil {
		return err
	}
	if n <= 1 {
		return apperr.Conflict("a project must keep at least one PM")
	}
	return nil
}

// Me runs in Update because it refreshes the caller's user_cache row.
func (s *Service) Me(ctx context.Context, userID int64) (MeView, error) {
	var out MeView
	err := s.st.Update(ctx, func(r store.Repos) error {
		ur, err := r.UserRoles.Get(ctx, userID)
		if err != nil {
			return err
		}
		if err := s.cacheUsers(ctx, r, userID); err != nil {
			return err
		}
		out = MeView{
			User:             UserView{ID: userID},
			IsAdmin:          ur != nil && ur.Role == "admin",
			CanCreateProject: authz.CanCreateProject(ur),
		}
		if cached, err := r.Users.Get(ctx, []int64{userID}); err != nil {
			return err
		} else if len(cached) > 0 {
			out.User.Name, out.User.AvatarURL = cached[0].DisplayName, cached[0].AvatarURL
		}
		return nil
	})
	return out, err
}

// SearchUsers feeds the member picker. An empty query answers an empty list
// rather than dumping every user.
func (s *Service) SearchUsers(ctx context.Context, q string) ([]UserView, error) {
	out := []UserView{}
	q = trim(q)
	if q == "" {
		return out, nil
	}
	found, err := s.up.Search(ctx, q, maxSearch)
	if err != nil {
		return nil, err
	}
	for i, u := range found {
		if i == maxSearch {
			break
		}
		out = append(out, UserView{ID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL})
	}
	return out, nil
}

// RefreshUserCache re-reads up to 200 cache rows not synced for olderThan and
// returns how many it updated.
func (s *Service) RefreshUserCache(ctx context.Context, olderThan time.Duration) (int, error) {
	var ids []int64
	err := s.st.View(ctx, func(r store.Repos) (err error) {
		ids, err = r.Users.Stale(ctx, s.now().Add(-olderThan), refreshBatch)
		return
	})
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	found, err := s.up.Get(ctx, ids)
	if err != nil || len(found) == 0 {
		return 0, err
	}
	cu := make([]store.CachedUser, len(found))
	for i, u := range found {
		cu[i] = store.CachedUser{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL, SyncedAt: s.now()}
	}
	err = s.st.Update(ctx, func(r store.Repos) error { return r.Users.Upsert(ctx, cu) })
	return len(cu), err
}
