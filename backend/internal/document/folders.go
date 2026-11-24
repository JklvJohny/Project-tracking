package document

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/store"
)

// access is the caller's standing in one project's report folder. Members
// (and admins) have their project role; someone the folder is shared with has
// no role at all, only the folder.
type access struct {
	project store.Project
	role    authz.Role // "" when the folder is only shared with the caller
}

func (a access) shared() bool { return a.role == "" }

// canUpload: anyone who edits cards in the project, and anyone the folder is
// shared with (the owner's decision, 2026-11-21).
func (a access) canUpload() bool {
	return a.shared() || authz.Require(a.role, authz.EditCards) == nil
}

// canShare: admin, PM and member. People the folder is shared with cannot
// pass it on.
func (a access) canShare() bool {
	return !a.shared() && authz.Require(a.role, authz.EditCards) == nil
}

// canManage deletes and restores anyone's report.
func (a access) canManage() bool {
	return !a.shared() && authz.Require(a.role, authz.ManageProject) == nil
}

func isNotFound(err error) bool {
	var ae *apperr.Error
	return errors.As(err, &ae) && ae.Code == "not_found"
}

// folderScope resolves the caller's access to a project's report folder:
// project members and admins through their role, others through a share.
// Anyone else gets not_found, so the project's existence is not revealed.
func folderScope(ctx context.Context, r store.Repos, userID, projectID int64) (access, error) {
	role, err := authz.ProjectRole(ctx, r, userID, projectID)
	if err != nil {
		if !isNotFound(err) {
			return access{}, err
		}
		if _, serr := r.Shares.Get(ctx, projectID, userID); serr != nil {
			if errors.Is(serr, store.ErrNotFound) {
				return access{}, err
			}
			return access{}, serr
		}
		role = ""
	}
	p, err := r.Projects.Get(ctx, projectID)
	if errors.Is(err, store.ErrNotFound) {
		return access{}, apperr.NotFound("project")
	}
	return access{project: p, role: role}, err
}

// Folder is one project's report folder as its viewer sees it.
type Folder struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	ArchivedAt    *time.Time `json:"archivedAt"`
	DocumentCount int        `json:"documentCount"`
	// Access is the caller's project role (admin, pm, member), or
	// "shared" when they are not in the project and the folder is shared with them.
	Access    string `json:"access"`
	CanUpload bool   `json:"canUpload"`
	CanShare  bool   `json:"canShare"`
	// CanManage deletes anyone's report; everyone who can upload deletes their own.
	CanManage bool `json:"canManage"`
}

func folderOf(a access, docs int) Folder {
	acc := string(a.role)
	if a.shared() {
		acc = "shared"
	}
	live := a.project.ArchivedAt == nil
	return Folder{
		ID: a.project.ID, Name: a.project.Name, ArchivedAt: a.project.ArchivedAt, DocumentCount: docs, Access: acc,
		CanUpload: live && a.canUpload(), CanShare: live && a.canShare(), CanManage: live && a.canManage(),
	}
}

// Folders lists every report folder the caller may open: all of them for an
// admin; otherwise their projects' and those shared with them, by project id.
func (s *Service) Folders(ctx context.Context, userID int64) ([]Folder, error) {
	out := []Folder{}
	err := s.st.View(ctx, func(r store.Repos) error {
		ur, err := r.UserRoles.Get(ctx, userID)
		if err != nil {
			return err
		}
		var as []access
		if ur != nil && ur.Role == "admin" {
			ps, err := r.Projects.All(ctx)
			if err != nil {
				return err
			}
			for _, p := range ps {
				as = append(as, access{project: p, role: authz.Admin})
			}
		} else {
			ps, err := r.Projects.ByMember(ctx, userID)
			if err != nil {
				return err
			}
			for _, p := range ps {
				m, err := r.Members.Get(ctx, p.ID, userID)
				if err != nil {
					return err
				}
				as = append(as, access{project: p, role: authz.Role(m.Role)})
			}
			shares, err := r.Shares.ByUser(ctx, userID)
			if err != nil {
				return err
			}
			for _, sh := range shares {
				if _, err := r.Members.Get(ctx, sh.ProjectID, userID); err == nil {
					continue // a member since the share: listed once, with their role
				}
				p, err := r.Projects.Get(ctx, sh.ProjectID)
				if err != nil {
					return err
				}
				as = append(as, access{project: p})
			}
			sort.Slice(as, func(i, j int) bool { return as[i].project.ID < as[j].project.ID })
		}
		ids := make([]int64, len(as))
		for i, a := range as {
			ids[i] = a.project.ID
		}
		sums, err := r.Projects.Summaries(ctx, ids)
		if err != nil {
			return err
		}
		for _, a := range as {
			out = append(out, folderOf(a, sums[a.project.ID].Documents))
		}
		return nil
	})
	return out, err
}

// Share is someone outside the project whom the folder is shared with.
type Share struct {
	UserID    int64     `json:"userId"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl"`
	SharedBy  int64     `json:"sharedBy"`
	CreatedAt time.Time `json:"createdAt"`
}

func canShare(ctx context.Context, r store.Repos, userID, projectID int64, write bool) error {
	a, err := folderScope(ctx, r, userID, projectID)
	if err != nil {
		return err
	}
	if !a.canShare() {
		return apperr.Forbidden()
	}
	if write && a.project.ArchivedAt != nil {
		return apperr.ProjectArchived()
	}
	return nil
}

// Shares lists who the folder is shared with, oldest share first. Only those
// who may share see it.
func (s *Service) Shares(ctx context.Context, userID, projectID int64) ([]Share, error) {
	var shares []store.FolderShare
	err := s.st.View(ctx, func(r store.Repos) (err error) {
		if err := canShare(ctx, r, userID, projectID, false); err != nil {
			return err
		}
		shares, err = r.Shares.ByProject(ctx, projectID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.shareViews(ctx, shares)
}

// shareViews names each share. It runs outside the store transaction: the user
// provider may read the store itself.
func (s *Service) shareViews(ctx context.Context, shares []store.FolderShare) ([]Share, error) {
	ids := make([]int64, len(shares))
	for i, sh := range shares {
		ids[i] = sh.UserID
	}
	found, err := s.up.Get(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]int, len(found))
	for i, u := range found {
		byID[u.ID] = i
	}
	out := make([]Share, 0, len(shares))
	for _, sh := range shares {
		v := Share{UserID: sh.UserID, SharedBy: sh.SharedBy, CreatedAt: sh.CreatedAt}
		if i, ok := byID[sh.UserID]; ok {
			v.Name, v.AvatarURL = found[i].Name, found[i].AvatarURL
		}
		out = append(out, v)
	}
	return out, nil
}

// ShareWith shares the folder with target, who must be a known user outside
// the project. Sharing again is a no-op that returns the existing share.
func (s *Service) ShareWith(ctx context.Context, userID, projectID, target int64) (Share, error) {
	found, err := s.up.Get(ctx, []int64{target})
	if err != nil {
		return Share{}, err
	}
	var sh store.FolderShare
	err = s.st.Update(ctx, func(r store.Repos) error {
		if err := canShare(ctx, r, userID, projectID, true); err != nil {
			return err
		}
		if len(found) == 0 {
			return apperr.NotFound("user")
		}
		if _, err := r.Members.Get(ctx, projectID, target); err == nil {
			return apperr.Validation(map[string]string{"userId": "already_member"})
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		// Look first: a duplicate insert aborts a PostgreSQL transaction, so the
		// existing share could not be read after it.
		existing, err := r.Shares.Get(ctx, projectID, target)
		if err == nil {
			sh = existing
			return nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		sh = store.FolderShare{ProjectID: projectID, UserID: target, SharedBy: userID, CreatedAt: s.now()}
		if err := r.Shares.Create(ctx, sh); err != nil {
			return err
		}
		return s.recordShare(ctx, r, projectID, userID, "folder.shared", target)
	})
	if err != nil {
		return Share{}, err
	}
	out, err := s.shareViews(ctx, []store.FolderShare{sh})
	if err != nil {
		return Share{}, err
	}
	return out[0], nil
}

// Unshare stops sharing the folder with target. Their uploads stay in the
// folder. Unsharing someone it was not shared with is a no-op.
func (s *Service) Unshare(ctx context.Context, userID, projectID, target int64) error {
	return s.st.Update(ctx, func(r store.Repos) error {
		if err := canShare(ctx, r, userID, projectID, true); err != nil {
			return err
		}
		err := r.Shares.Delete(ctx, projectID, target)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		return s.recordShare(ctx, r, projectID, userID, "folder.unshared", target)
	})
}

func (s *Service) recordShare(ctx context.Context, r store.Repos, projectID, actor int64, typ string, target int64) error {
	b, err := json.Marshal(map[string]any{"userId": target})
	if err != nil {
		return err
	}
	return r.Activity.Append(ctx, store.ActivityEvent{
		ProjectID: projectID, ActorID: actor, Type: typ, Payload: b, CreatedAt: s.now(),
	})
}
