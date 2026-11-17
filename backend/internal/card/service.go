// Package card serves card reads and writes: create, edit, move, archive and
// assignees.
package card

import (
	"context"
	"encoding/json"
	"errors"
	"time"
	"unicode/utf8"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/board"
	"tracking-service/internal/clock"
	"tracking-service/internal/events"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
	"tracking-service/internal/validate"
)

const (
	maxTitle       = 200
	maxDescription = 20000
)

type Service struct {
	st  store.Store
	up  users.Provider   // reserved: members are cached when they join the project
	ev  events.Publisher // reserved: card events are not published yet
	now clock.Clock
}

func New(st store.Store, up users.Provider, ev events.Publisher, now clock.Clock) *Service {
	return &Service{st: st, up: up, ev: ev, now: now}
}

type ChecklistItemView struct {
	ID       int64  `json:"id"`
	Text     string `json:"text"`
	IsDone   bool   `json:"isDone"`
	Position string `json:"position"`
}

// CardDetail is the full card: description, assignees, labels and checklist.
// Comments are served separately.
type CardDetail struct {
	ID            int64               `json:"id"`
	ListID        int64               `json:"listId"`
	Title         string              `json:"title"`
	DescriptionMD string              `json:"descriptionMd"`
	Priority      string              `json:"priority"`
	StartDate     *string             `json:"startDate"`
	DueDate       *string             `json:"dueDate"`
	Position      string              `json:"position"`
	CompletedAt   *time.Time          `json:"completedAt"`
	CreatedAt     time.Time           `json:"createdAt"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	ArchivedAt    *time.Time          `json:"archivedAt"`
	AssigneeIDs   []int64             `json:"assigneeIds"`
	LabelIDs      []int64             `json:"labelIds"`
	Checklist     []ChecklistItemView `json:"checklist"`
}

type CreateCardInput struct {
	Title string `json:"title"`
}

// OptDate tells an absent JSON key (Set false: leave the date alone) from
// null (Set, nil Value: clear it) and from a string (Set, non-nil: replace).
type OptDate struct {
	Set   bool
	Value *string
}

// SetDate builds an OptDate that is present; nil clears.
func SetDate(v *string) OptDate { return OptDate{Set: true, Value: v} }

func (o *OptDate) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}

// UpdateCardInput is a partial update: a nil pointer or unset OptDate leaves
// the field alone.
type UpdateCardInput struct {
	Title         *string `json:"title"`
	DescriptionMD *string `json:"descriptionMd"`
	Priority      *string `json:"priority"`
	StartDate     OptDate `json:"startDate"`
	DueDate       OptDate `json:"dueDate"`
}

type MoveCardInput struct {
	ToListID int64  `json:"toListId"`
	BeforeID *int64 `json:"beforeId"`
	AfterID  *int64 `json:"afterId"`
}

func dateStr(d *store.Date) *string {
	if d == nil {
		return nil
	}
	s := string(*d)
	return &s
}

func (s *Service) detail(ctx context.Context, r store.Repos, c store.Card) (CardDetail, error) {
	ch, err := r.Cards.Children(ctx, c.ID)
	if err != nil {
		return CardDetail{}, err
	}
	d := CardDetail{
		ID: c.ID, ListID: c.ListID, Title: c.Title, DescriptionMD: c.Description,
		Priority: store.PriorityName(c.Priority), StartDate: dateStr(c.StartDate), DueDate: dateStr(c.DueDate),
		Position: c.Position, CompletedAt: c.CompletedAt, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		ArchivedAt: c.ArchivedAt, AssigneeIDs: ch.AssigneeIDs, LabelIDs: ch.LabelIDs,
		Checklist: make([]ChecklistItemView, len(ch.Checklist)),
	}
	for i, it := range ch.Checklist {
		d.Checklist[i] = ChecklistItemView{ID: it.ID, Text: it.Text, IsDone: it.IsDone, Position: it.Position}
	}
	return d, nil
}

// scope is everything a card route resolves before looking at the request.
type scope struct {
	card    store.Card
	list    store.List
	project store.Project
	role    authz.Role
}

// resolveList walks list -> board -> project -> role. Membership is checked
// first, so a non-member gets not_found whatever else is wrong.
func resolveList(ctx context.Context, r store.Repos, userID, listID int64) (store.List, store.Project, authz.Role, error) {
	l, err := r.Lists.Get(ctx, listID)
	if errors.Is(err, store.ErrNotFound) {
		return l, store.Project{}, "", apperr.NotFound("list")
	}
	if err != nil {
		return l, store.Project{}, "", err
	}
	b, err := r.Boards.Get(ctx, l.BoardID)
	if err != nil {
		return l, store.Project{}, "", err
	}
	role, err := authz.ProjectRole(ctx, r, userID, b.ProjectID)
	if err != nil {
		return l, store.Project{}, "", err
	}
	p, err := r.Projects.Get(ctx, b.ProjectID)
	return l, p, role, err
}

func resolveCard(ctx context.Context, r store.Repos, userID, cardID int64) (scope, error) {
	c, err := r.Cards.Get(ctx, cardID)
	if errors.Is(err, store.ErrNotFound) {
		return scope{}, apperr.NotFound("card")
	}
	if err != nil {
		return scope{}, err
	}
	l, p, role, err := resolveList(ctx, r, userID, c.ListID)
	return scope{card: c, list: l, project: p, role: role}, err
}

// writable checks the rules every write shares: EditCards and a live project.
func writable(role authz.Role, p store.Project) error {
	if err := authz.Require(role, authz.EditCards); err != nil {
		return err
	}
	if p.ArchivedAt != nil {
		return apperr.Conflict("project is archived")
	}
	return nil
}

// resolveEditable is resolveCard for a write on a live card.
func resolveEditable(ctx context.Context, r store.Repos, userID, cardID int64) (scope, error) {
	sc, err := resolveCard(ctx, r, userID, cardID)
	if err != nil {
		return sc, err
	}
	if err := writable(sc.role, sc.project); err != nil {
		return sc, err
	}
	if sc.card.ArchivedAt != nil {
		return sc, apperr.Conflict("card is archived")
	}
	return sc, nil
}

func (s *Service) record(ctx context.Context, r store.Repos, projectID, cardID, actor int64, typ string, payload map[string]any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return r.Activity.Append(ctx, store.ActivityEvent{
		ProjectID: projectID, CardID: &cardID, ActorID: actor, Type: typ, Payload: b, CreatedAt: s.now(),
	})
}

// placeCard runs the shared move flow against one list's cards. recheck runs
// right after the list lock.
func placeCard(ctx context.Context, r store.Repos, listID, movingID int64, in board.MoveInput, recheck func() error) (string, error) {
	lock := func(ctx context.Context) error {
		if err := r.Cards.LockList(ctx, listID); err != nil {
			return err
		}
		if recheck != nil {
			return recheck()
		}
		return nil
	}
	read := func(ctx context.Context) ([]store.IDPos, error) { return r.Cards.Positions(ctx, listID) }
	return board.PlaceLocked(ctx, lock, read, r.Cards.SetPositions, movingID, in)
}

// listLive re-reads the list under the lock, so a concurrent archive cannot
// slip between check and write.
func listLive(ctx context.Context, r store.Repos, listID int64) (store.List, error) {
	l, err := r.Lists.Get(ctx, listID)
	if errors.Is(err, store.ErrNotFound) {
		return l, apperr.NotFound("list")
	}
	if err != nil {
		return l, err
	}
	if l.ArchivedAt != nil {
		return l, apperr.Conflict("list is archived")
	}
	return l, nil
}

func (s *Service) Create(ctx context.Context, userID, listID int64, in CreateCardInput) (CardDetail, error) {
	var out CardDetail
	err := s.st.Update(ctx, func(r store.Repos) error {
		l, p, role, err := resolveList(ctx, r, userID, listID)
		if err != nil {
			return err
		}
		if err := writable(role, p); err != nil {
			return err
		}
		if l.ArchivedAt != nil {
			return apperr.Conflict("list is archived")
		}
		fields := map[string]string{}
		title := validate.Text("title", in.Title, maxTitle, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		pos, err := placeCard(ctx, r, l.ID, 0, board.MoveInput{}, func() error { _, err := listLive(ctx, r, l.ID); return err })
		if err != nil {
			return err
		}
		now := s.now()
		c := store.Card{ListID: l.ID, Title: title, Position: pos, CreatedBy: userID, CreatedAt: now, UpdatedAt: now}
		if l.IsDone {
			c.CompletedAt = &now
		}
		if c, err = r.Cards.Create(ctx, c); err != nil {
			return err
		}
		if err := r.Boards.Touch(ctx, l.BoardID, now); err != nil {
			return err
		}
		if err := s.record(ctx, r, p.ID, c.ID, userID, "card.created", map[string]any{"cardId": c.ID, "listId": l.ID}); err != nil {
			return err
		}
		out, err = s.detail(ctx, r, c)
		return err
	})
	return out, err
}

func (s *Service) Get(ctx context.Context, userID, cardID int64) (CardDetail, error) {
	var out CardDetail
	err := s.st.View(ctx, func(r store.Repos) error {
		sc, err := resolveCard(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		out, err = s.detail(ctx, r, sc.card)
		return err
	})
	return out, err
}

func (s *Service) Update(ctx context.Context, userID, cardID int64, in UpdateCardInput) (CardDetail, error) {
	var out CardDetail
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveEditable(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		c := sc.card
		fields := map[string]string{}
		changed := []string{}
		if in.Title != nil {
			c.Title = validate.Text("title", *in.Title, maxTitle, fields)
			changed = append(changed, "title")
		}
		if in.DescriptionMD != nil {
			if utf8.RuneCountInString(*in.DescriptionMD) > maxDescription {
				fields["descriptionMd"] = "too_long"
			}
			c.Description = *in.DescriptionMD
			changed = append(changed, "descriptionMd")
		}
		if in.Priority != nil {
			if p, ok := store.ParsePriority(*in.Priority); ok {
				c.Priority = p
			} else {
				fields["priority"] = "invalid"
			}
			changed = append(changed, "priority")
		}
		apply := func(field string, o OptDate, cur **store.Date) {
			if !o.Set {
				return
			}
			*cur = validate.Date(field, o.Value, fields) // a nil value clears
			changed = append(changed, field)
		}
		apply("startDate", in.StartDate, &c.StartDate)
		apply("dueDate", in.DueDate, &c.DueDate)
		if fields["startDate"] == "" && fields["dueDate"] == "" {
			validate.DateOrder("dueDate", c.StartDate, c.DueDate, fields)
		}
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		now := s.now()
		c.UpdatedAt = now
		if err := r.Cards.Save(ctx, c); err != nil {
			return err
		}
		if err := r.Boards.Touch(ctx, sc.list.BoardID, now); err != nil {
			return err
		}
		if err := s.record(ctx, r, sc.project.ID, c.ID, userID, "card.updated", map[string]any{"cardId": c.ID, "fields": changed}); err != nil {
			return err
		}
		out, err = s.detail(ctx, r, c)
		return err
	})
	return out, err
}

func (s *Service) Move(ctx context.Context, userID, cardID int64, in MoveCardInput) (CardDetail, error) {
	var out CardDetail
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveEditable(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		// the target must be in the same project; anything else is "not found"
		// so a list elsewhere is never confirmed to exist
		to, err := r.Lists.Get(ctx, in.ToListID)
		if errors.Is(err, store.ErrNotFound) {
			return apperr.NotFound("list")
		}
		if err != nil {
			return err
		}
		tb, err := r.Boards.Get(ctx, to.BoardID)
		if err != nil {
			return err
		}
		if tb.ProjectID != sc.project.ID {
			return apperr.NotFound("list")
		}
		pos, err := placeCard(ctx, r, to.ID, sc.card.ID, board.MoveInput{BeforeID: in.BeforeID, AfterID: in.AfterID}, func() error {
			if to, err = listLive(ctx, r, to.ID); err != nil {
				return err
			}
			cur, err := r.Cards.Get(ctx, sc.card.ID)
			if err != nil {
				return err
			}
			if cur.ArchivedAt != nil {
				return apperr.Conflict("card is archived")
			}
			return nil
		})
		if err != nil {
			return err
		}
		now := s.now()
		c := sc.card
		c.ListID, c.Position, c.UpdatedAt = to.ID, pos, now
		switch {
		case to.ID == sc.list.ID: // keeps completedAt
		case to.IsDone && !sc.list.IsDone && c.CompletedAt == nil:
			c.CompletedAt = &now
		case !to.IsDone && sc.list.IsDone:
			c.CompletedAt = nil
		}
		if err := r.Cards.Save(ctx, c); err != nil {
			return err
		}
		if err := r.Boards.Touch(ctx, to.BoardID, now); err != nil {
			return err
		}
		if err := s.record(ctx, r, sc.project.ID, c.ID, userID, "card.moved",
			map[string]any{"cardId": c.ID, "fromListId": sc.list.ID, "toListId": to.ID}); err != nil {
			return err
		}
		out, err = s.detail(ctx, r, c)
		return err
	})
	return out, err
}

func (s *Service) Archive(ctx context.Context, userID, cardID int64) (CardDetail, error) {
	return s.setArchived(ctx, userID, cardID, true)
}

// Restore puts the card back at the end of its list.
func (s *Service) Restore(ctx context.Context, userID, cardID int64) (CardDetail, error) {
	return s.setArchived(ctx, userID, cardID, false)
}

func (s *Service) setArchived(ctx context.Context, userID, cardID int64, archive bool) (CardDetail, error) {
	var out CardDetail
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveCard(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		if err := writable(sc.role, sc.project); err != nil {
			return err
		}
		c := sc.card
		if archive == (c.ArchivedAt != nil) { // already there: nothing to do
			out, err = s.detail(ctx, r, c)
			return err
		}
		typ := "card.archived"
		now := s.now()
		if archive {
			c.ArchivedAt = &now
		} else {
			typ = "card.restored"
			if sc.list.ArchivedAt != nil {
				return apperr.Conflict("list is archived")
			}
			if c.Position, err = placeCard(ctx, r, c.ListID, c.ID, board.MoveInput{}, func() error {
				_, err := listLive(ctx, r, c.ListID)
				return err
			}); err != nil {
				return err
			}
			c.ArchivedAt = nil
			// the list's Done flag may have changed while the card was away
			switch {
			case sc.list.IsDone && c.CompletedAt == nil:
				c.CompletedAt = &now
			case !sc.list.IsDone:
				c.CompletedAt = nil
			}
		}
		c.UpdatedAt = now
		if err := r.Cards.Save(ctx, c); err != nil {
			return err
		}
		if err := r.Boards.Touch(ctx, sc.list.BoardID, now); err != nil {
			return err
		}
		if err := s.record(ctx, r, sc.project.ID, c.ID, userID, typ, map[string]any{"cardId": c.ID}); err != nil {
			return err
		}
		out, err = s.detail(ctx, r, c)
		return err
	})
	return out, err
}

// Assign adds a project member to the card. A repeat is a no-op: no write, no
// event.
func (s *Service) Assign(ctx context.Context, userID, cardID, memberID int64) (CardDetail, error) {
	return s.setAssignee(ctx, userID, cardID, memberID, true)
}

func (s *Service) Unassign(ctx context.Context, userID, cardID, memberID int64) (CardDetail, error) {
	return s.setAssignee(ctx, userID, cardID, memberID, false)
}

func (s *Service) setAssignee(ctx context.Context, userID, cardID, memberID int64, add bool) (CardDetail, error) {
	var out CardDetail
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveEditable(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		now := s.now()
		var did bool
		typ := "card.unassigned"
		if add {
			typ = "card.assigned"
			if _, err := r.Members.Get(ctx, sc.project.ID, memberID); errors.Is(err, store.ErrNotFound) {
				return apperr.Validation(map[string]string{"userId": "not_member"})
			} else if err != nil {
				return err
			}
			did, err = r.Cards.AddAssignee(ctx, cardID, memberID, now)
		} else {
			did, err = r.Cards.RemoveAssignee(ctx, cardID, memberID)
		}
		if err != nil {
			return err
		}
		if did {
			if err := r.Cards.Touch(ctx, cardID, now); err != nil {
				return err
			}
			if err := r.Boards.Touch(ctx, sc.list.BoardID, now); err != nil {
				return err
			}
			if err := s.record(ctx, r, sc.project.ID, cardID, userID, typ, map[string]any{"cardId": cardID, "userId": memberID}); err != nil {
				return err
			}
		}
		c, err := r.Cards.Get(ctx, cardID)
		if err != nil {
			return err
		}
		out, err = s.detail(ctx, r, c)
		return err
	})
	return out, err
}
