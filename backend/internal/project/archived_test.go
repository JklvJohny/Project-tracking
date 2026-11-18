package project_test

import (
	"testing"

	"tracking-service/internal/project"
)

// projectArchived is the conflict token the UI keys on for an archived project.
func projectArchived(err error) bool {
	return code(err) == "conflict" && err.Error() == "project_archived"
}

// An archived project is read-only for everyone; Restore is the only write.
func TestArchivedProject_ReadOnlyUntilRestored(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, regular, "member"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Archive(e.ctx, manager, p.ID); err != nil {
		t.Fatal(err)
	}
	for _, by := range []int64{manager, admin} {
		if _, err := e.svc.Update(e.ctx, by, p.ID, project.UpdateProjectInput{Name: ptr("N")}); !projectArchived(err) {
			t.Fatalf("update by %d: %v", by, err)
		}
	}
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, other, "member"); !projectArchived(err) {
		t.Fatalf("add member: %v", err)
	}
	if _, err := e.svc.SetRole(e.ctx, manager, p.ID, regular, "viewer"); !projectArchived(err) {
		t.Fatalf("set role: %v", err)
	}
	if err := e.svc.RemoveMember(e.ctx, manager, p.ID, regular); !projectArchived(err) {
		t.Fatalf("remove member: %v", err)
	}
	// a member without ManageProject still gets forbidden first
	if _, err := e.svc.Update(e.ctx, regular, p.ID, project.UpdateProjectInput{Name: ptr("N")}); code(err) != "forbidden" {
		t.Fatalf("member update: %v", err)
	}
	if _, err := e.svc.Restore(e.ctx, manager, p.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if got, err := e.svc.Update(e.ctx, manager, p.ID, project.UpdateProjectInput{Name: ptr("N")}); err != nil || got.Name != "N" {
		t.Fatalf("update after restore: %+v %v", got, err)
	}
}
