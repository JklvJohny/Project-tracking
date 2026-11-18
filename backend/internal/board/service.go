// Package board serves the board read model (with its ETag source) and the
// list writes.
package board

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

const maxListName = 100

type Service struct {
	st  store.Store
	ev  events.Publisher // reserved: board events are not published yet
	now clock.Clock
}

func New(st store.Store, ev events.Publisher, now clock.Clock) *Service {
	return &Service{st: st, ev: ev, now: now}
}

type BoardInfo struct {
	ID        int64     `json:"id"`
	ProjectID int64     `json:"projectId"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectInfo struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	OwnerID     int64      `json:"ownerId"`
	Status      string     `json:"status"`
	StartDate   *string    `json:"startDate"`
	EndDate     *string    `json:"endDate"`
	ArchivedAt  *time.Time `json:"archivedAt"`
}

type ListView struct {
	ID         int64      `json:"id"`
	BoardID    int64      `json:"boardId"`
	Name       string     `json:"name"`
	Position   string     `json:"position"`
	IsDone     bool       `json:"isDone"`
	WIPLimit   *int       `json:"wipLimit"`
	ArchivedAt *time.Time `json:"archivedAt"`
}

// CardSummaryView has no description: the board must stay small.
type CardSummaryView struct {
	ID             int64      `json:"id"`
	ListID         int64      `json:"listId"`
	Title          string     `json:"title"`
	Priority       string     `json:"priority"`
	StartDate      *string    `json:"startDate"`
	DueDate        *string    `json:"dueDate"`
	Position       string     `json:"position"`
	CompletedAt    *time.Time `json:"completedAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	LabelIDs       []int64    `json:"labelIds"`
	AssigneeIDs    []int64    `json:"assigneeIds"`
	ChecklistTotal int        `json:"checklistTotal"`
	ChecklistDone  int        `json:"checklistDone"`
	CommentCount   int        `json:"commentCount"`
	// ChecklistPreview is the first 3 items by position, for the card face.
	ChecklistPreview []ChecklistPreviewItem `json:"checklistPreview"`
}

type ChecklistPreviewItem struct {
	ID     int64  `json:"id"`
	Text   string `json:"text"`
	IsDone bool   `json:"isDone"`
}

type LabelView struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type MemberView struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	Role      string `json:"role"`
}

type UserView struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type BoardView struct {
	Board   BoardInfo         `json:"board"`
	Project ProjectInfo       `json:"project"`
	MyRole  string            `json:"myRole"`
	Lists   []ListView        `json:"lists"`
	Cards   []CardSummaryView `json:"cards"`
	Labels  []LabelView       `json:"labels"`
	Members []MemberView      `json:"members"`
	Users   []UserView        `json:"users"`
}

type ArchivedView struct {
	Lists []ListView        `json:"lists"`
	Cards []CardSummaryView `json:"cards"`
}

// UpdateListInput is a partial update: nil leaves a field alone.
type UpdateListInput struct {
	Name   *string `json:"name"`
	IsDone *bool   `json:"isDone"`
}

func listView(l store.List) ListView {
	return ListView{ID: l.ID, BoardID: l.BoardID, Name: l.Name, Position: l.Position, IsDone: l.IsDone,
		WIPLimit: l.WIPLimit, ArchivedAt: l.ArchivedAt}
}

func dateStr(d *store.Date) *string {
	if d == nil {
		return nil
	}
	s := string(*d)
	return &s
}

func cardView(c store.CardSummary) CardSummaryView {
	pv := make([]ChecklistPreviewItem, len(c.ChecklistPreview))
	for i, it := range c.ChecklistPreview {
		pv[i] = ChecklistPreviewItem{ID: it.ID, Text: it.Text, IsDone: it.IsDone}
	}
	return CardSummaryView{ChecklistPreview: pv,
		ID: c.ID, ListID: c.ListID, Title: c.Title, Priority: store.PriorityName(c.Priority),
		StartDate: dateStr(c.StartDate), DueDate: dateStr(c.DueDate), Position: c.Position,
		CompletedAt: c.CompletedAt, UpdatedAt: c.UpdatedAt,
		LabelIDs: nonNil(c.LabelIDs), AssigneeIDs: nonNil(c.AssigneeIDs),
		ChecklistTotal: c.ChecklistTotal, ChecklistDone: c.ChecklistDone, CommentCount: c.CommentCount,
	}
}

func nonNil(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}

// loadProject resolves the project and the caller's role; a non-member gets
// not_found before anything is revealed.
func loadProject(ctx context.Context, r store.Repos, userID, projectID int64) (store.Project, authz.Role, error) {
	role, err := authz.ProjectRole(ctx, r, userID, projectID)
	if err != nil {
		return store.Project{}, "", err
	}
	p, err := r.Projects.Get(ctx, projectID)
	if errors.Is(err, store.ErrNotFound) {
		return store.Project{}, "", apperr.NotFound("project")
	}
	return p, role, err
}

// loadManaged is loadProject for a list write: ManageProject is required and
// an archived project is read-only.
func loadManaged(ctx context.Context, r store.Repos, userID, projectID int64) (store.Project, error) {
	p, role, err := loadProject(ctx, r, userID, projectID)
	if err != nil {
		return p, err
	}
	if err := authz.Require(role, authz.ManageProject); err != nil {
		return p, err
	}
	if p.ArchivedAt != nil {
		return p, apperr.ProjectArchived()
	}
	// Lock order: the board row is the first lock of every write. The checks
	// above ran unlocked, so they are repeated on fresh rows once it is held.
	b, err := r.Boards.ByProject(ctx, projectID)
	if errors.Is(err, store.ErrNotFound) {
		return p, apperr.NotFound("board")
	}
	if err != nil {
		return p, err
	}
	if err := r.Boards.Lock(ctx, b.ID); err != nil {
		return p, err
	}
	return recheckManaged(ctx, r, userID, projectID)
}

func recheckManaged(ctx context.Context, r store.Repos, userID, projectID int64) (store.Project, error) {
	p, role, err := loadProject(ctx, r, userID, projectID)
	if err != nil {
		return p, err
	}
	if err := authz.Require(role, authz.ManageProject); err != nil {
		return p, err
	}
	if p.ArchivedAt != nil {
		return p, apperr.ProjectArchived()
	}
	return p, nil
}

// loadList resolves a list to its project first, so a non-member learns
// nothing about the list.
func loadList(ctx context.Context, r store.Repos, userID, listID int64) (store.List, store.Project, error) {
	l, err := r.Lists.Get(ctx, listID)
	if errors.Is(err, store.ErrNotFound) {
		return l, store.Project{}, apperr.NotFound("list")
	}
	if err != nil {
		return l, store.Project{}, err
	}
	b, err := r.Boards.Get(ctx, l.BoardID)
	if err != nil {
		return l, store.Project{}, err
	}
	p, err := loadManaged(ctx, r, userID, b.ProjectID) // takes the board lock
	if err != nil {
		return l, p, apperr.NotFoundAs(err, "list")
	}
	l, err = r.Lists.Get(ctx, listID) // fresh, now that the lock is held
	if errors.Is(err, store.ErrNotFound) {
		return l, p, apperr.NotFound("list")
	}
	return l, p, err
}

func (s *Service) record(ctx context.Context, r store.Repos, projectID, actor int64, typ string, payload map[string]any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return r.Activity.Append(ctx, store.ActivityEvent{ProjectID: projectID, ActorID: actor, Type: typ, Payload: b, CreatedAt: s.now()})
}

func (s *Service) touch(ctx context.Context, r store.Repos, boardID int64) error {
	return r.Boards.Touch(ctx, boardID, s.now())
}

// Board returns the snapshot and the caller's role (an ETag part).
func (s *Service) Board(ctx context.Context, userID, projectID int64) (BoardView, authz.Role, error) {
	var out BoardView
	var role authz.Role
	err := s.st.View(ctx, func(r store.Repos) error {
		var err error
		if _, role, err = loadProject(ctx, r, userID, projectID); err != nil {
			return err
		}
		snap, err := r.Boards.Snapshot(ctx, projectID)
		if errors.Is(err, store.ErrNotFound) {
			return apperr.NotFound("board")
		}
		if err != nil {
			return err
		}
		p := snap.Project
		out = BoardView{
			Board: BoardInfo{ID: snap.Board.ID, ProjectID: snap.Board.ProjectID, UpdatedAt: snap.Board.UpdatedAt},
			Project: ProjectInfo{ID: p.ID, Name: p.Name, Description: p.Description, OwnerID: p.OwnerID,
				Status: p.Status, StartDate: dateStr(p.StartDate), EndDate: dateStr(p.EndDate), ArchivedAt: p.ArchivedAt},
			MyRole: string(role),
			Lists:  make([]ListView, len(snap.Lists)), Cards: make([]CardSummaryView, len(snap.Cards)),
			Labels: make([]LabelView, len(snap.Labels)), Members: make([]MemberView, len(snap.Members)),
			Users: make([]UserView, len(snap.Users)),
		}
		names := map[int64]store.CachedUser{}
		for i, u := range snap.Users {
			out.Users[i] = UserView{ID: u.UserID, Name: u.DisplayName, AvatarURL: u.AvatarURL}
			names[u.UserID] = u
		}
		for i, l := range snap.Lists {
			out.Lists[i] = listView(l)
		}
		for i, c := range snap.Cards {
			out.Cards[i] = cardView(c)
		}
		for i, l := range snap.Labels {
			out.Labels[i] = LabelView{ID: l.ID, Name: l.Name, Color: l.Color}
		}
		for i, m := range snap.Members {
			u := names[m.UserID]
			out.Members[i] = MemberView{UserID: m.UserID, Name: u.DisplayName, AvatarURL: u.AvatarURL, Role: m.Role}
		}
		return nil
	})
	return out, role, err
}

// Archived returns the archived lists and cards of the project's board.
func (s *Service) Archived(ctx context.Context, userID, projectID int64) (ArchivedView, error) {
	out := ArchivedView{Lists: []ListView{}, Cards: []CardSummaryView{}}
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, _, err := loadProject(ctx, r, userID, projectID); err != nil {
			return err
		}
		b, err := r.Boards.ByProject(ctx, projectID)
		if errors.Is(err, store.ErrNotFound) {
			return apperr.NotFound("board")
		}
		if err != nil {
			return err
		}
		ls, cs, err := r.Lists.Archived(ctx, b.ID)
		if err != nil {
			return err
		}
		for _, l := range ls {
			out.Lists = append(out.Lists, listView(l))
		}
		for _, c := range cs {
			out.Cards = append(out.Cards, cardView(c))
		}
		return nil
	})
	return out, err
}

// placeList runs the shared move flow (PlaceLocked) against one board's
// lists. recheck, if set, runs right after the board lock.
func placeList(ctx context.Context, r store.Repos, boardID, movingID int64, in MoveInput, recheck func() error) (string, error) {
	lock := func(ctx context.Context) error {
		if err := r.Boards.Lock(ctx, boardID); err != nil {
			return err
		}
		if recheck != nil {
			return recheck()
		}
		return nil
	}
	read := func(ctx context.Context) ([]store.IDPos, error) { return r.Lists.Positions(ctx, boardID) }
	return PlaceLocked(ctx, lock, read, r.Lists.SetPositions, movingID, in)
}

func (s *Service) CreateList(ctx context.Context, userID, projectID int64, name string) (ListView, error) {
	var out ListView
	err := s.st.Update(ctx, func(r store.Repos) error {
		if _, err := loadManaged(ctx, r, userID, projectID); err != nil {
			return err
		}
		fields := map[string]string{}
		name = validate.Text("name", name, maxListName, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		b, err := r.Boards.ByProject(ctx, projectID)
		if err != nil {
			return err
		}
		pos, err := placeList(ctx, r, b.ID, 0, MoveInput{}, nil)
		if err != nil {
			return err
		}
		now := s.now()
		l, err := r.Lists.Create(ctx, store.List{BoardID: b.ID, Name: name, Position: pos, CreatedAt: now, UpdatedAt: now})
		if err != nil {
			return err
		}
		if err := s.touch(ctx, r, b.ID); err != nil {
			return err
		}
		out = listView(l)
		return s.record(ctx, r, projectID, userID, "list.created", map[string]any{"listId": l.ID})
	})
	return out, err
}

func (s *Service) UpdateList(ctx context.Context, userID, listID int64, in UpdateListInput) (ListView, error) {
	var out ListView
	err := s.st.Update(ctx, func(r store.Repos) error {
		l, p, err := loadList(ctx, r, userID, listID)
		if err != nil {
			return err
		}
		fields := map[string]string{}
		payload := map[string]any{"listId": l.ID}
		if in.Name != nil {
			l.Name = validate.Text("name", *in.Name, maxListName, fields)
			payload["name"] = l.Name
		}
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		now := s.now()
		if in.IsDone != nil {
			// every request carrying isDone re-applies it, so cards added since
			// the flag was set are caught up
			var at *time.Time
			if *in.IsDone {
				at = &now
			}
			if err := r.Cards.SetCompletedForList(ctx, l.ID, at); err != nil {
				return err
			}
			l.IsDone = *in.IsDone
			payload["isDone"] = l.IsDone
		}
		l.UpdatedAt = now
		if err := r.Lists.Save(ctx, l); err != nil {
			return err
		}
		if err := s.touch(ctx, r, l.BoardID); err != nil {
			return err
		}
		out = listView(l)
		return s.record(ctx, r, p.ID, userID, "list.updated", payload)
	})
	return out, err
}

func (s *Service) MoveList(ctx context.Context, userID, listID int64, in MoveInput) (ListView, error) {
	var out ListView
	err := s.st.Update(ctx, func(r store.Repos) error {
		l, p, err := loadList(ctx, r, userID, listID)
		if err != nil {
			return err
		}
		// the archived check runs under the lock, so a concurrent archive
		// cannot slip between check and write
		pos, err := placeList(ctx, r, l.BoardID, l.ID, in, func() error {
			cur, err := r.Lists.Get(ctx, l.ID)
			if err != nil {
				return err
			}
			if cur.ArchivedAt != nil {
				return apperr.Conflict("list is archived")
			}
			return nil
		})
		if err != nil {
			return err
		}
		l.Position, l.UpdatedAt = pos, s.now()
		if err := r.Lists.Save(ctx, l); err != nil {
			return err
		}
		if err := s.touch(ctx, r, l.BoardID); err != nil {
			return err
		}
		out = listView(l)
		return s.record(ctx, r, p.ID, userID, "list.moved", map[string]any{"listId": l.ID})
	})
	return out, err
}

func (s *Service) ArchiveList(ctx context.Context, userID, listID int64) (ListView, error) {
	return s.setArchived(ctx, userID, listID, true)
}

// RestoreList puts the list back at the end of the board.
func (s *Service) RestoreList(ctx context.Context, userID, listID int64) (ListView, error) {
	return s.setArchived(ctx, userID, listID, false)
}

func (s *Service) setArchived(ctx context.Context, userID, listID int64, archive bool) (ListView, error) {
	var out ListView
	err := s.st.Update(ctx, func(r store.Repos) error {
		l, p, err := loadList(ctx, r, userID, listID)
		if err != nil {
			return err
		}
		out = listView(l)
		if archive == (l.ArchivedAt != nil) {
			return nil
		}
		typ := "list.archived"
		now := s.now()
		if archive {
			l.ArchivedAt = &now
		} else {
			typ = "list.restored"
			l.ArchivedAt = nil
			if l.Position, err = placeList(ctx, r, l.BoardID, l.ID, MoveInput{}, nil); err != nil {
				return err
			}
		}
		l.UpdatedAt = now
		if err := r.Lists.Save(ctx, l); err != nil {
			return err
		}
		if err := s.touch(ctx, r, l.BoardID); err != nil {
			return err
		}
		out = listView(l)
		return s.record(ctx, r, p.ID, userID, typ, map[string]any{"listId": l.ID})
	})
	return out, err
}
