package memory

import (
	"context"
	"sort"

	"tracking-service/internal/store"
)

type commentRepo struct{ d *data }

func (r *commentRepo) Create(_ context.Context, c store.Comment) (store.Comment, error) {
	c.ID = r.d.nextID("comments")
	r.d.comments[c.ID] = c
	return c, nil
}

func (r *commentRepo) Get(_ context.Context, id int64) (store.Comment, error) {
	c, ok := r.d.comments[id]
	if !ok {
		return c, store.ErrNotFound
	}
	return c, nil
}

func (r *commentRepo) Save(_ context.Context, c store.Comment) error {
	if _, ok := r.d.comments[c.ID]; !ok {
		return store.ErrNotFound
	}
	r.d.comments[c.ID] = c
	return nil
}

func (r *commentRepo) ByCard(_ context.Context, cardID int64) ([]store.Comment, error) {
	out := []store.Comment{}
	for _, c := range r.d.comments {
		if c.CardID == cardID && c.DeletedAt == nil {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (r *commentRepo) Mentions(_ context.Context, commentID int64) ([]int64, error) {
	out := []int64{}
	for k := range r.d.mentions {
		if k.CommentID == commentID {
			out = append(out, k.UserID)
		}
	}
	sortIDs(out)
	return out, nil
}

func (r *commentRepo) MentionsByCard(_ context.Context, cardID int64) (map[int64][]int64, error) {
	out := map[int64][]int64{}
	for k := range r.d.mentions {
		c, ok := r.d.comments[k.CommentID]
		if ok && c.CardID == cardID && c.DeletedAt == nil {
			out[k.CommentID] = append(out[k.CommentID], k.UserID)
		}
	}
	for _, ids := range out {
		sortIDs(ids)
	}
	return out, nil
}

func (r *commentRepo) SetMentions(_ context.Context, commentID int64, userIDs []int64) error {
	if _, ok := r.d.comments[commentID]; !ok {
		return store.ErrNotFound
	}
	for k := range r.d.mentions {
		if k.CommentID == commentID {
			delete(r.d.mentions, k)
		}
	}
	for _, u := range userIDs {
		r.d.mentions[mentionKey{CommentID: commentID, UserID: u}] = store.CommentMention{CommentID: commentID, UserID: u}
	}
	return nil
}
