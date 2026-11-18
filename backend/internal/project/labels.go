package project

import (
	"context"
	"errors"

	"tracking-service/internal/apperr"
	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

const maxLabelName = 40

var labelColors = map[string]bool{"green": true, "yellow": true, "red": true, "blue": true, "purple": true, "gray": true}

type LabelView struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"projectId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
}

type LabelInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// LabelPatch is a partial update: nil leaves a field alone.
type LabelPatch struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func labelView(l store.Label) LabelView {
	return LabelView{ID: l.ID, ProjectID: l.ProjectID, Name: l.Name, Color: l.Color}
}

// writableProject is loadWritable for label writes, which need no role.
func writableProject(ctx context.Context, r store.Repos, userID, projectID int64) (store.Project, error) {
	p, _, err := loadWritable(ctx, r, userID, projectID)
	return p, err
}

// loadLabel resolves label -> project -> role. Membership is checked before
// anything else is revealed, so a non-member never learns more than not_found.
func loadLabel(ctx context.Context, r store.Repos, userID, labelID int64) (store.Label, store.Project, error) {
	l, err := r.Labels.Get(ctx, labelID)
	if errors.Is(err, store.ErrNotFound) {
		return l, store.Project{}, apperr.NotFound("label")
	}
	if err != nil {
		return l, store.Project{}, err
	}
	p, err := writableProject(ctx, r, userID, l.ProjectID) // takes the board lock
	if err != nil {
		return l, p, apperr.NotFoundAs(err, "label")
	}
	l, err = r.Labels.Get(ctx, labelID) // fresh, now that the lock is held
	if errors.Is(err, store.ErrNotFound) {
		return l, p, apperr.NotFound("label")
	}
	return l, p, err
}

func checkColor(c string, fields map[string]string) {
	if !labelColors[c] {
		fields["color"] = "invalid"
	}
}

func (s *Service) Labels(ctx context.Context, userID, projectID int64) ([]LabelView, error) {
	var out []LabelView
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, _, err := load(ctx, r, userID, projectID); err != nil {
			return err
		}
		ls, err := r.Labels.ByProject(ctx, projectID)
		if err != nil {
			return err
		}
		out = make([]LabelView, len(ls))
		for i, l := range ls {
			out[i] = labelView(l)
		}
		return nil
	})
	return out, err
}

func (s *Service) CreateLabel(ctx context.Context, userID, projectID int64, in LabelInput) (LabelView, error) {
	var out LabelView
	err := s.st.Update(ctx, func(r store.Repos) error {
		if _, err := writableProject(ctx, r, userID, projectID); err != nil {
			return err
		}
		fields := map[string]string{}
		name := validate.Text("name", in.Name, maxLabelName, fields)
		checkColor(in.Color, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		if taken, err := r.Labels.NameTaken(ctx, projectID, name, 0); err != nil {
			return err
		} else if taken {
			return apperr.Conflict(ConflictLabelNameInUse)
		}
		l, err := r.Labels.Create(ctx, store.Label{ProjectID: projectID, Name: name, Color: in.Color})
		if err != nil {
			return err
		}
		if err := s.touchBoard(ctx, r, projectID); err != nil {
			return err
		}
		if err := s.record(ctx, r, projectID, userID, "label.created", map[string]any{"labelId": l.ID}); err != nil {
			return err
		}
		out = labelView(l)
		return nil
	})
	return out, err
}

func (s *Service) UpdateLabel(ctx context.Context, userID, labelID int64, in LabelPatch) (LabelView, error) {
	var out LabelView
	err := s.st.Update(ctx, func(r store.Repos) error {
		l, p, err := loadLabel(ctx, r, userID, labelID)
		if err != nil {
			return err
		}
		fields := map[string]string{}
		changed := []string{}
		if in.Name != nil {
			l.Name = validate.Text("name", *in.Name, maxLabelName, fields)
			changed = append(changed, "name")
		}
		if in.Color != nil {
			checkColor(*in.Color, fields)
			l.Color = *in.Color
			changed = append(changed, "color")
		}
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		if in.Name != nil {
			if taken, err := r.Labels.NameTaken(ctx, p.ID, l.Name, l.ID); err != nil {
				return err
			} else if taken {
				return apperr.Conflict(ConflictLabelNameInUse)
			}
		}
		if err := r.Labels.Save(ctx, l); err != nil {
			return err
		}
		if err := s.touchBoard(ctx, r, p.ID); err != nil {
			return err
		}
		if err := s.record(ctx, r, p.ID, userID, "label.updated", map[string]any{"labelId": l.ID, "fields": changed}); err != nil {
			return err
		}
		out = labelView(l)
		return nil
	})
	return out, err
}

// DeleteLabel hard-deletes: labels are configuration, not history. Cards that
// carried it are touched so their caches refetch.
func (s *Service) DeleteLabel(ctx context.Context, userID, labelID int64) error {
	return s.st.Update(ctx, func(r store.Repos) error {
		l, p, err := loadLabel(ctx, r, userID, labelID)
		if err != nil {
			return err
		}
		cards, err := r.Labels.Delete(ctx, l.ID)
		if err != nil {
			return err
		}
		now := s.now()
		for _, id := range cards {
			if err := r.Cards.Touch(ctx, id, now); err != nil {
				return err
			}
		}
		if err := s.touchBoard(ctx, r, p.ID); err != nil {
			return err
		}
		return s.record(ctx, r, p.ID, userID, "label.deleted", map[string]any{"labelId": l.ID})
	})
}
