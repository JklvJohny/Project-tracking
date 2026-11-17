package card

import (
	"context"
	"errors"

	"tracking-service/internal/apperr"
	"tracking-service/internal/board"
	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

const maxItemText = 500

// ItemPatch is a partial update; nil leaves the field alone.
type ItemPatch struct {
	Text   *string `json:"text"`
	IsDone *bool   `json:"isDone"`
}

type addItemInput struct {
	Text string `json:"text"`
}

func itemView(it store.ChecklistItem) ChecklistItemView {
	return ChecklistItemView{ID: it.ID, Text: it.Text, IsDone: it.IsDone, Position: it.Position}
}

// resolveItem walks item -> card -> list -> board -> project -> role, so a
// non-member gets not_found before anything else, then checks the write rules.
func resolveItem(ctx context.Context, r store.Repos, userID, itemID int64) (store.ChecklistItem, scope, error) {
	it, err := r.Checklist.Get(ctx, itemID)
	if errors.Is(err, store.ErrNotFound) {
		return it, scope{}, apperr.NotFound("checklist item")
	}
	if err != nil {
		return it, scope{}, err
	}
	sc, err := resolveEditable(ctx, r, userID, it.CardID)
	return it, sc, err
}

// touch bumps the card and the board and logs the event; every write ends here.
func (s *Service) touch(ctx context.Context, r store.Repos, sc scope, userID int64, typ string, itemID int64, extra map[string]any) error {
	now := s.now()
	if err := r.Cards.Touch(ctx, sc.card.ID, now); err != nil {
		return err
	}
	if err := r.Boards.Touch(ctx, sc.list.BoardID, now); err != nil {
		return err
	}
	payload := map[string]any{"cardId": sc.card.ID, "itemId": itemID}
	for k, v := range extra {
		payload[k] = v
	}
	return s.record(ctx, r, sc.project.ID, sc.card.ID, userID, typ, payload)
}

// placeItem runs the shared move flow against one card's checklist. The card
// row is the lock; it is re-read after the lock so a concurrent archive cannot
// slip in.
func placeItem(ctx context.Context, r store.Repos, cardID, movingID int64, in board.MoveInput) (string, error) {
	lock := func(ctx context.Context) error {
		if err := r.Checklist.LockCard(ctx, cardID); err != nil {
			return err
		}
		c, err := r.Cards.Get(ctx, cardID)
		if err != nil {
			return err
		}
		if c.ArchivedAt != nil {
			return apperr.Conflict("card is archived")
		}
		return nil
	}
	read := func(ctx context.Context) ([]store.IDPos, error) { return r.Checklist.Positions(ctx, cardID) }
	return board.PlaceLocked(ctx, lock, read, r.Checklist.SetPositions, movingID, in)
}

// AddItem appends an item at the end of the card's checklist.
func (s *Service) AddItem(ctx context.Context, userID, cardID int64, text string) (ChecklistItemView, error) {
	var out ChecklistItemView
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveEditable(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		fields := map[string]string{}
		text = validate.Text("text", text, maxItemText, fields)
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		pos, err := placeItem(ctx, r, cardID, 0, board.MoveInput{})
		if err != nil {
			return err
		}
		it, err := r.Checklist.Create(ctx, store.ChecklistItem{CardID: cardID, Text: text, Position: pos, UpdatedAt: s.now()})
		if err != nil {
			return err
		}
		out = itemView(it)
		return s.touch(ctx, r, sc, userID, "checklist.added", it.ID, nil)
	})
	return out, err
}

func (s *Service) UpdateItem(ctx context.Context, userID, itemID int64, in ItemPatch) (ChecklistItemView, error) {
	var out ChecklistItemView
	err := s.st.Update(ctx, func(r store.Repos) error {
		it, sc, err := resolveItem(ctx, r, userID, itemID)
		if err != nil {
			return err
		}
		if in.Text == nil && in.IsDone == nil {
			return apperr.BadRequest("empty patch")
		}
		fields := map[string]string{}
		changed := []string{}
		if in.Text != nil {
			it.Text = validate.Text("text", *in.Text, maxItemText, fields)
			changed = append(changed, "text")
		}
		if in.IsDone != nil {
			it.IsDone = *in.IsDone
			changed = append(changed, "isDone")
		}
		if len(fields) > 0 {
			return apperr.Validation(fields)
		}
		it.UpdatedAt = s.now()
		if err := r.Checklist.Save(ctx, it); err != nil {
			return err
		}
		out = itemView(it)
		return s.touch(ctx, r, sc, userID, "checklist.updated", it.ID, map[string]any{"fields": changed})
	})
	return out, err
}

// MoveItem reorders within the card; neighbours of another card are stale_order.
func (s *Service) MoveItem(ctx context.Context, userID, itemID int64, in board.MoveInput) (ChecklistItemView, error) {
	var out ChecklistItemView
	err := s.st.Update(ctx, func(r store.Repos) error {
		it, sc, err := resolveItem(ctx, r, userID, itemID)
		if err != nil {
			return err
		}
		pos, err := placeItem(ctx, r, it.CardID, it.ID, in)
		if err != nil {
			return err
		}
		it.Position, it.UpdatedAt = pos, s.now()
		if err := r.Checklist.Save(ctx, it); err != nil {
			return err
		}
		out = itemView(it)
		return s.touch(ctx, r, sc, userID, "checklist.moved", it.ID, nil)
	})
	return out, err
}

func (s *Service) DeleteItem(ctx context.Context, userID, itemID int64) error {
	return s.st.Update(ctx, func(r store.Repos) error {
		it, sc, err := resolveItem(ctx, r, userID, itemID)
		if err != nil {
			return err
		}
		if err := r.Checklist.Delete(ctx, it.ID); err != nil {
			return err
		}
		return s.touch(ctx, r, sc, userID, "checklist.deleted", it.ID, nil)
	})
}
