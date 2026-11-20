package memory

import (
	"context"
	"sort"

	"tracking-service/internal/store"
)

type folderShareRepo struct{ d *data }

func (r *folderShareRepo) Get(_ context.Context, projectID, userID int64) (store.FolderShare, error) {
	s, ok := r.d.shares[memberKey{projectID, userID}]
	if !ok {
		return s, store.ErrNotFound
	}
	return s, nil
}

func (r *folderShareRepo) ByProject(_ context.Context, projectID int64) ([]store.FolderShare, error) {
	out := r.collect(func(s store.FolderShare) bool { return s.ProjectID == projectID })
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].UserID < out[j].UserID
	})
	return out, nil
}

func (r *folderShareRepo) ByUser(_ context.Context, userID int64) ([]store.FolderShare, error) {
	out := r.collect(func(s store.FolderShare) bool { return s.UserID == userID })
	sort.Slice(out, func(i, j int) bool { return out[i].ProjectID < out[j].ProjectID })
	return out, nil
}

func (r *folderShareRepo) collect(keep func(store.FolderShare) bool) []store.FolderShare {
	out := []store.FolderShare{}
	for _, s := range r.d.shares {
		if keep(s) {
			out = append(out, s)
		}
	}
	return out
}

func (r *folderShareRepo) Create(_ context.Context, s store.FolderShare) error {
	k := memberKey{s.ProjectID, s.UserID}
	if _, ok := r.d.shares[k]; ok {
		return store.ErrDuplicate
	}
	r.d.shares[k] = s
	return nil
}

func (r *folderShareRepo) Delete(_ context.Context, projectID, userID int64) error {
	k := memberKey{projectID, userID}
	if _, ok := r.d.shares[k]; !ok {
		return store.ErrNotFound
	}
	delete(r.d.shares, k)
	return nil
}
