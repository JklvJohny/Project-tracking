package authz_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
)

func TestRequire_Table(t *testing.T) {
	// "" is someone outside the project (a report folder shared with them is checked apart).
	all := func(admin, pm, member bool) map[authz.Role]bool {
		return map[authz.Role]bool{authz.Admin: admin, authz.PM: pm, authz.Member: member, "": false}
	}
	rows := []struct {
		a    authz.Action
		want map[authz.Role]bool
	}{
		{authz.View, all(true, true, true)},
		{authz.ManageProject, all(true, true, false)},
		{authz.EditCards, all(true, true, true)},
		{authz.Comment, all(true, true, true)},
		{authz.DeleteAnyComment, all(true, true, false)},
	}
	for _, r := range rows {
		for role, allowed := range r.want {
			err := authz.Require(role, r.a)
			var ae *apperr.Error
			if allowed && err != nil {
				t.Errorf("action %d role %s: unexpected %v", r.a, role, err)
			}
			if !allowed && (!errors.As(err, &ae) || ae.Code != "forbidden") {
				t.Errorf("action %d role %s: want forbidden, got %v", r.a, role, err)
			}
		}
	}
}

func TestCanCreateProject(t *testing.T) {
	if authz.CanCreateProject(nil) || authz.CanCreateProject(&store.UserRole{Role: "other"}) {
		t.Error("regular user must not create")
	}
	if !authz.CanCreateProject(&store.UserRole{Role: "admin"}) || !authz.CanCreateProject(&store.UserRole{Role: "manager"}) {
		t.Error("admin and manager must create")
	}
}

func TestProjectRole(t *testing.T) {
	ctx := context.Background()
	st := memory.New(func() time.Time { return time.Unix(0, 0) })
	st.SeedUserRole(store.UserRole{UserID: 1, Role: "admin"})
	_ = st.Update(ctx, func(r store.Repos) error {
		return r.Members.Put(ctx, store.Member{ProjectID: 10, UserID: 2, Role: "member"})
	})
	_ = st.View(ctx, func(r store.Repos) error {
		if role, err := authz.ProjectRole(ctx, r, 1, 10); err != nil || role != authz.Admin {
			t.Errorf("admin: %v %v", role, err)
		}
		if role, err := authz.ProjectRole(ctx, r, 2, 10); err != nil || role != authz.Member {
			t.Errorf("member: %v %v", role, err)
		}
		_, err := authz.ProjectRole(ctx, r, 3, 10)
		var ae *apperr.Error
		if !errors.As(err, &ae) || ae.Code != "not_found" {
			t.Errorf("outsider: %v", err)
		}
		return nil
	})
}
