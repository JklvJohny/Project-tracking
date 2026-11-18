package project_test

import (
	"testing"

	"tracking-service/internal/project"
)

// The UI tells these conflicts apart by the error token, so the tokens are API.
func TestConflictTokens(t *testing.T) {
	e := newEnv(t)
	a := e.mustCreate(t, manager, "A")
	b := e.mustCreate(t, manager, "B")

	_, err := e.svc.Update(e.ctx, manager, b.ID, project.UpdateProjectInput{Name: ptr("a")})
	if code(err) != "conflict" || err.Error() != "name_in_use" {
		t.Errorf("name in use: %v", err)
	}
	err = e.svc.RemoveMember(e.ctx, manager, a.ID, manager)
	if code(err) != "conflict" || err.Error() != "last_pm" {
		t.Errorf("last pm: %v", err)
	}
	if _, err = e.svc.AddMember(e.ctx, manager, a.ID, regular, "member"); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.AddMember(e.ctx, manager, a.ID, regular, "member")
	if code(err) != "conflict" || err.Error() != "already_member" {
		t.Errorf("already member: %v", err)
	}
	e.mustLabel(t, a.ID, "Bug", "red")
	_, err = e.svc.CreateLabel(e.ctx, manager, a.ID, project.LabelInput{Name: "bug", Color: "blue"})
	if code(err) != "conflict" || err.Error() != "label_name_in_use" {
		t.Errorf("label name in use: %v", err)
	}
}
