// Package authz holds the server-side permission rules. Every service calls
// it; the UI only mirrors it.
package authz

import (
	"context"
	"errors"

	"tracking-service/internal/apperr"
	"tracking-service/internal/store"
)

type Role string

const (
	Admin  Role = "admin"
	PM     Role = "pm"
	Member Role = "member"
	Viewer Role = "viewer"
)

type Action int

const (
	View Action = iota
	ManageProject
	EditCards
	Comment
	DeleteAnyComment
)

// ProjectRole resolves the caller's role in a project. Anyone who is neither
// a system admin nor a member gets not_found, so a project's existence is not
// revealed to outsiders.
func ProjectRole(ctx context.Context, r store.Repos, userID, projectID int64) (Role, error) {
	ur, err := r.UserRoles.Get(ctx, userID)
	if err != nil {
		return "", err
	}
	if ur != nil && ur.Role == "admin" {
		return Admin, nil
	}
	m, err := r.Members.Get(ctx, projectID, userID)
	if errors.Is(err, store.ErrNotFound) {
		return "", apperr.NotFound("project")
	}
	if err != nil {
		return "", err
	}
	return Role(m.Role), nil
}

// Require returns forbidden when the role lacks the action.
func Require(role Role, a Action) error {
	var ok bool
	switch a {
	case View:
		ok = role == Admin || role == PM || role == Member || role == Viewer
	case ManageProject, DeleteAnyComment:
		ok = role == Admin || role == PM
	case EditCards, Comment:
		ok = role == Admin || role == PM || role == Member
	}
	if !ok {
		return apperr.Forbidden()
	}
	return nil
}

// CanCreateProject is true for system admins and managers.
func CanCreateProject(ur *store.UserRole) bool {
	return ur != nil && (ur.Role == "admin" || ur.Role == "manager")
}
