package card

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"strconv"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

const (
	maxCommentBody = 5000
	topicMentioned = "tracking.comment.mentioned"
)

var mentionRe = regexp.MustCompile(`@\[(\d+)\]`)

// ParseMentions returns the unique ids written as @[id], in order of first
// appearance. Ids that overflow int64 are skipped.
func ParseMentions(body string) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, m := range mentionRe.FindAllStringSubmatch(body, -1) {
		id, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil || id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

type Comment struct {
	ID         int64      `json:"id"`
	CardID     int64      `json:"cardId"`
	AuthorID   int64      `json:"authorId"`
	BodyMD     string     `json:"bodyMd"`
	CreatedAt  time.Time  `json:"createdAt"`
	EditedAt   *time.Time `json:"editedAt"`
	MentionIDs []int64    `json:"mentionIds"`
}

// CommentMentioned is the payload of tracking.comment.mentioned.
type CommentMentioned struct {
	CommentID int64   `json:"commentId"`
	CardID    int64   `json:"cardId"`
	ProjectID int64   `json:"projectId"`
	UserIDs   []int64 `json:"userIds"`
}

type commentInput struct {
	Body string `json:"body"`
}

func commentView(c store.Comment, mentions []int64) Comment {
	if mentions == nil {
		mentions = []int64{}
	}
	return Comment{ID: c.ID, CardID: c.CardID, AuthorID: c.AuthorID, BodyMD: c.Body,
		CreatedAt: c.CreatedAt, EditedAt: c.EditedAt, MentionIDs: mentions}
}

// resolveComment walks comment -> card -> list -> board -> project -> role, so
// a non-member gets not_found before anything else. A soft-deleted comment is
// gone for every caller.
func resolveComment(ctx context.Context, r store.Repos, userID, commentID int64) (store.Comment, scope, error) {
	cm, err := r.Comments.Get(ctx, commentID)
	if errors.Is(err, store.ErrNotFound) {
		return cm, scope{}, apperr.NotFound("comment")
	}
	if err != nil {
		return cm, scope{}, err
	}
	sc, err := resolveCard(ctx, r, userID, cm.CardID)
	if err != nil {
		return cm, sc, err
	}
	if cm.DeletedAt != nil {
		return cm, sc, apperr.NotFound("comment")
	}
	return cm, sc, nil
}

// liveForWrite is the check every comment write shares once the role passed.
func liveForWrite(sc scope) error {
	if sc.project.ArchivedAt != nil {
		return apperr.Conflict("project is archived")
	}
	if sc.card.ArchivedAt != nil {
		return apperr.Conflict("card is archived")
	}
	return nil
}

func validBody(body string) (string, error) {
	fields := map[string]string{}
	body = validate.Text("body", body, maxCommentBody, fields)
	if len(fields) > 0 {
		return "", apperr.Validation(fields)
	}
	return body, nil
}

// memberMentions keeps the mentioned ids that are members of the project;
// admins who are not members are not mentionable.
func memberMentions(ctx context.Context, r store.Repos, projectID int64, body string) ([]int64, error) {
	out := []int64{}
	for _, id := range ParseMentions(body) {
		_, err := r.Members.Get(ctx, projectID, id)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// newMentions returns the ids in cur that are not in prev.
func newMentions(prev, cur []int64) []int64 {
	had := map[int64]bool{}
	for _, id := range prev {
		had[id] = true
	}
	out := []int64{}
	for _, id := range cur {
		if !had[id] {
			out = append(out, id)
		}
	}
	return out
}

// publishMentioned runs after the transaction committed: a failed write must
// never notify anyone. A publish failure is logged, not returned, because the
// comment already exists.
func (s *Service) publishMentioned(ctx context.Context, commentID, cardID, projectID int64, userIDs []int64) {
	if len(userIDs) == 0 {
		return
	}
	err := s.ev.Publish(ctx, topicMentioned, CommentMentioned{CommentID: commentID, CardID: cardID, ProjectID: projectID, UserIDs: userIDs})
	if err != nil {
		slog.WarnContext(ctx, "publish comment mention failed", "commentId", commentID, "err", err)
	}
}

// Comments lists the card's live comments, oldest first.
func (s *Service) Comments(ctx context.Context, userID, cardID int64) ([]Comment, error) {
	out := []Comment{}
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, err := resolveCard(ctx, r, userID, cardID); err != nil {
			return err
		}
		cs, err := r.Comments.ByCard(ctx, cardID)
		if err != nil {
			return err
		}
		ms, err := r.Comments.MentionsByCard(ctx, cardID)
		if err != nil {
			return err
		}
		for _, c := range cs {
			out = append(out, commentView(c, ms[c.ID]))
		}
		return nil
	})
	return out, err
}

// commentTouch bumps card and board (the board shows the comment count) and
// logs the event.
func (s *Service) commentTouch(ctx context.Context, r store.Repos, sc scope, userID, commentID int64, typ string) error {
	now := s.now()
	if err := r.Cards.Touch(ctx, sc.card.ID, now); err != nil {
		return err
	}
	if err := r.Boards.Touch(ctx, sc.list.BoardID, now); err != nil {
		return err
	}
	return s.record(ctx, r, sc.project.ID, sc.card.ID, userID, typ, map[string]any{"cardId": sc.card.ID, "commentId": commentID})
}

func (s *Service) AddComment(ctx context.Context, userID, cardID int64, body string) (Comment, error) {
	var out Comment
	var fresh []int64
	var projectID int64
	err := s.st.Update(ctx, func(r store.Repos) error {
		sc, err := resolveCard(ctx, r, userID, cardID)
		if err != nil {
			return err
		}
		if err := authz.Require(sc.role, authz.Comment); err != nil {
			return err
		}
		if err := liveForWrite(sc); err != nil {
			return err
		}
		if body, err = validBody(body); err != nil {
			return err
		}
		if err := lockLiveCard(ctx, r, cardID); err != nil {
			return err
		}
		ids, err := memberMentions(ctx, r, sc.project.ID, body)
		if err != nil {
			return err
		}
		cm, err := r.Comments.Create(ctx, store.Comment{CardID: cardID, AuthorID: userID, Body: body, CreatedAt: s.now()})
		if err != nil {
			return err
		}
		if err := r.Comments.SetMentions(ctx, cm.ID, ids); err != nil {
			return err
		}
		out, fresh, projectID = commentView(cm, ids), ids, sc.project.ID
		return s.commentTouch(ctx, r, sc, userID, cm.ID, "comment.added")
	})
	if err != nil {
		return Comment{}, err
	}
	s.publishMentioned(ctx, out.ID, cardID, projectID, fresh)
	return out, nil
}

// EditComment is for the author only, whatever the caller's role.
func (s *Service) EditComment(ctx context.Context, userID, commentID int64, body string) (Comment, error) {
	var out Comment
	var fresh []int64
	var projectID int64
	err := s.st.Update(ctx, func(r store.Repos) error {
		cm, sc, err := resolveComment(ctx, r, userID, commentID)
		if err != nil {
			return err
		}
		if cm.AuthorID != userID {
			return apperr.Forbidden()
		}
		if err := liveForWrite(sc); err != nil {
			return err
		}
		if body, err = validBody(body); err != nil {
			return err
		}
		if err := lockLiveCard(ctx, r, cm.CardID); err != nil {
			return err
		}
		// re-read under the lock: a concurrent delete must not be overwritten
		if cm, err = r.Comments.Get(ctx, commentID); err != nil {
			return err
		}
		if cm.DeletedAt != nil {
			return apperr.NotFound("comment")
		}
		prev, err := r.Comments.Mentions(ctx, commentID)
		if err != nil {
			return err
		}
		ids, err := memberMentions(ctx, r, sc.project.ID, body)
		if err != nil {
			return err
		}
		now := s.now()
		cm.Body, cm.EditedAt = body, &now
		if err := r.Comments.Save(ctx, cm); err != nil {
			return err
		}
		if err := r.Comments.SetMentions(ctx, commentID, ids); err != nil {
			return err
		}
		out, fresh, projectID = commentView(cm, ids), newMentions(prev, ids), sc.project.ID
		return s.commentTouch(ctx, r, sc, userID, commentID, "comment.edited")
	})
	if err != nil {
		return Comment{}, err
	}
	s.publishMentioned(ctx, out.ID, out.CardID, projectID, fresh)
	return out, nil
}

// DeleteComment soft-deletes: the author, or a role with DeleteAnyComment.
func (s *Service) DeleteComment(ctx context.Context, userID, commentID int64) error {
	return s.st.Update(ctx, func(r store.Repos) error {
		cm, sc, err := resolveComment(ctx, r, userID, commentID)
		if err != nil {
			return err
		}
		if cm.AuthorID != userID {
			if err := authz.Require(sc.role, authz.DeleteAnyComment); err != nil {
				return err
			}
		}
		if err := liveForWrite(sc); err != nil {
			return err
		}
		if err := lockLiveCard(ctx, r, cm.CardID); err != nil {
			return err
		}
		if cm, err = r.Comments.Get(ctx, commentID); err != nil {
			return err
		}
		if cm.DeletedAt != nil {
			return apperr.NotFound("comment")
		}
		now := s.now()
		cm.DeletedAt = &now
		if err := r.Comments.Save(ctx, cm); err != nil {
			return err
		}
		return s.commentTouch(ctx, r, sc, userID, commentID, "comment.deleted")
	})
}
