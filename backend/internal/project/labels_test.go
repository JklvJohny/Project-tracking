package project_test

import (
	"errors"
	"strconv"
	"strings"
	"testing"

	"tracking-service/internal/apperr"
	"tracking-service/internal/project"
)

func id(n int64) string { return strconv.FormatInt(n, 10) }

func fieldsOf(err error) map[string]string {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		return ae.Fields
	}
	return nil
}

func (e env) mustLabel(t *testing.T, pid int64, name, color string) project.LabelView {
	t.Helper()
	l, err := e.svc.CreateLabel(e.ctx, manager, pid, project.LabelInput{Name: name, Color: color})
	if err != nil {
		t.Fatalf("label %q: %v", name, err)
	}
	return l
}

func TestCreateLabel_BadColorValidation(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	_, err := e.svc.CreateLabel(e.ctx, manager, p.ID, project.LabelInput{Name: "x", Color: "pink"})
	if code(err) != "validation_failed" || fieldsOf(err)["color"] != "invalid" {
		t.Fatalf("err = %v %v", err, fieldsOf(err))
	}
	_, err = e.svc.CreateLabel(e.ctx, manager, p.ID, project.LabelInput{Name: strings.Repeat("ก", 41), Color: "red"})
	if fieldsOf(err)["name"] != "too_long" {
		t.Fatalf("41 runes: %v", fieldsOf(err))
	}
	if _, err = e.svc.CreateLabel(e.ctx, manager, p.ID, project.LabelInput{Name: strings.Repeat("ก", 40), Color: "red"}); err != nil {
		t.Fatalf("40 runes: %v", err)
	}
}

func TestCreateLabel_DuplicateNameConflict(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	e.mustLabel(t, p.ID, "Bug", "red")
	_, err := e.svc.CreateLabel(e.ctx, manager, p.ID, project.LabelInput{Name: " bUG ", Color: "blue"})
	if code(err) != "conflict" {
		t.Fatalf("err = %v", err)
	}
	// the same name is fine in another project
	q := e.mustCreate(t, manager, "Q")
	e.mustLabel(t, q.ID, "Bug", "red")
}

func TestUpdateLabel_RenameClashConflictButSelfOK(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	a := e.mustLabel(t, p.ID, "A", "red")
	e.mustLabel(t, p.ID, "B", "blue")
	if _, err := e.svc.UpdateLabel(e.ctx, manager, a.ID, project.LabelPatch{Name: ptr("b")}); code(err) != "conflict" {
		t.Fatalf("clash: %v", err)
	}
	got, err := e.svc.UpdateLabel(e.ctx, manager, a.ID, project.LabelPatch{Name: ptr("a"), Color: ptr("green")})
	if err != nil || got.Name != "a" || got.Color != "green" {
		t.Fatalf("self rename: %v %+v", err, got)
	}
	if _, err := e.svc.UpdateLabel(e.ctx, manager, a.ID, project.LabelPatch{Color: ptr("nope")}); fieldsOf(err)["color"] != "invalid" {
		t.Fatalf("bad color: %v", err)
	}
}

func TestCreateLabel_MemberForbidden(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	if _, err := e.svc.AddMember(e.ctx, manager, p.ID, regular, "member"); err != nil {
		t.Fatal(err)
	}
	l := e.mustLabel(t, p.ID, "Bug", "red")
	if _, err := e.svc.CreateLabel(e.ctx, regular, p.ID, project.LabelInput{Name: "x", Color: "red"}); code(err) != "forbidden" {
		t.Fatalf("create: %v", err)
	}
	if _, err := e.svc.UpdateLabel(e.ctx, regular, l.ID, project.LabelPatch{Color: ptr("blue")}); code(err) != "forbidden" {
		t.Fatalf("update: %v", err)
	}
	if err := e.svc.DeleteLabel(e.ctx, regular, l.ID); code(err) != "forbidden" {
		t.Fatalf("delete: %v", err)
	}
	// any member can list
	ls, err := e.svc.Labels(e.ctx, regular, p.ID)
	if err != nil || len(ls) != 1 || ls[0].ProjectID != p.ID {
		t.Fatalf("list: %v %+v", err, ls)
	}
	if _, err := e.svc.Labels(e.ctx, other, p.ID); code(err) != "not_found" {
		t.Fatalf("non-member list: %v", err)
	}
}

func TestLabelWrites_ArchivedProjectConflict(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	l := e.mustLabel(t, p.ID, "Bug", "red")
	if _, err := e.svc.Archive(e.ctx, manager, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CreateLabel(e.ctx, manager, p.ID, project.LabelInput{Name: "x", Color: "red"}); !projectArchived(err) {
		t.Fatalf("create: %v", err)
	}
	if _, err := e.svc.UpdateLabel(e.ctx, manager, l.ID, project.LabelPatch{Color: ptr("blue")}); !projectArchived(err) {
		t.Fatalf("update: %v", err)
	}
	if err := e.svc.DeleteLabel(e.ctx, manager, l.ID); !projectArchived(err) {
		t.Fatalf("delete: %v", err)
	}
}

func TestLabelWrites_AppendActivity(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	l := e.mustLabel(t, p.ID, "Bug", "red")
	if _, err := e.svc.UpdateLabel(e.ctx, manager, l.ID, project.LabelPatch{Color: ptr("blue")}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteLabel(e.ctx, manager, l.ID); err != nil {
		t.Fatal(err)
	}
	var types []string
	for _, ev := range e.st.Activity() {
		if strings.HasPrefix(ev.Type, "label.") {
			types = append(types, ev.Type)
		}
	}
	if strings.Join(types, ",") != "label.created,label.updated,label.deleted" {
		t.Fatalf("events = %v", types)
	}
}

func TestLabelRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	p := e.mustCreate(t, manager, "P")
	l := e.mustLabel(t, p.ID, "Bug", "red")
	pid, lid := id(p.ID), id(l.ID)
	for _, rc := range []struct{ method, path, body string }{
		{"GET", "/projects/" + pid + "/labels", ""},
		{"POST", "/projects/" + pid + "/labels", `{"name":"x","color":"red"}`},
		{"PATCH", "/labels/" + lid, `{"name":"x"}`},
		{"DELETE", "/labels/" + lid, ""},
	} {
		rec, body := call(h, other, rc.method, rc.path, rc.body)
		if rec.Code != 404 || body["code"] != "not_found" || body["data"] != nil {
			t.Errorf("%s %s = %d %s", rc.method, rc.path, rec.Code, rec.Body)
		}
	}
	rec, _ := call(h, other, "DELETE", "/labels/9999", "")
	if rec.Code != 404 {
		t.Errorf("unknown label = %d", rec.Code)
	}
	// manager round trip over HTTP
	rec, body := call(h, manager, "POST", "/projects/"+pid+"/labels", `{"name":"New","color":"gray"}`)
	if rec.Code != 201 || body["data"].(map[string]any)["projectId"] == nil {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "DELETE", "/labels/"+lid, ""); rec.Code != 200 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
}

func TestUpdateLabel_NonMemberLooksLikeMissing(t *testing.T) {
	e := newEnv(t)
	p := e.mustCreate(t, manager, "P")
	l := e.mustLabel(t, p.ID, "Bug", "red")
	_, a := e.svc.UpdateLabel(e.ctx, regular, l.ID, project.LabelPatch{Color: ptr("blue")})
	_, b := e.svc.UpdateLabel(e.ctx, manager, 999, project.LabelPatch{Color: ptr("blue")})
	if code(a) != "not_found" || a.Error() != b.Error() {
		t.Fatalf("outsider %v, missing %v", a, b)
	}
}
