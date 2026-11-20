package document_test

import (
	"context"
	"strconv"
	"testing"
)

func (e env) sharePath(user int64) string {
	return "/projects/" + strconv.FormatInt(e.pid, 10) + "/folder-shares/" + strconv.FormatInt(user, 10)
}

// folderIDs returns the ids and access of the folders user sees.
func (e env) folders(t *testing.T, user int64) map[int64]map[string]any {
	t.Helper()
	rec, body := e.call(user, "GET", "/report-folders", nil, "")
	if rec.Code != 200 {
		t.Fatalf("folders as %d = %d %s", user, rec.Code, rec.Body)
	}
	out := map[int64]map[string]any{}
	for _, f := range body["data"].([]any) {
		m := f.(map[string]any)
		out[int64(m["id"].(float64))] = m
	}
	return out
}

func TestFolders_OnlyMembersAdminsAndSharedSeeAFolder(t *testing.T) {
	e := newEnv(t)
	if _, b := e.upload(member, "a.pdf", pdf("1")); b["success"] != true {
		t.Fatalf("upload: %v", b)
	}
	if f := e.folders(t, outside); len(f) != 0 {
		t.Fatalf("an outsider sees %v", f)
	}
	if f := e.folders(t, admin)[e.pid]; f == nil || f["access"] != "admin" || f["documentCount"].(float64) != 1 || f["canShare"] != true {
		t.Fatalf("admin folder = %v", f)
	}
	if f := e.folders(t, viewer)[e.pid]; f["access"] != "viewer" || f["canUpload"] != false || f["canShare"] != false {
		t.Fatalf("viewer folder = %v", f)
	}
	if rec, _ := e.call(outside, "GET", e.listPath(), nil, ""); rec.Code != 404 {
		t.Fatalf("outsider list = %d", rec.Code)
	}

	// A member shares it.
	rec, b := e.call(member, "PUT", e.sharePath(outside), nil, "")
	if rec.Code != 200 || b["data"].(map[string]any)["name"] != "ปิยะ มั่นคง" {
		t.Fatalf("share = %d %s", rec.Code, rec.Body)
	}
	f := e.folders(t, outside)[e.pid]
	if f == nil || f["access"] != "shared" || f["canUpload"] != true || f["canShare"] != false || f["canManage"] != false {
		t.Fatalf("shared folder = %v", f)
	}
	// They read, download and upload, and delete only their own.
	_, list := e.call(outside, "GET", e.listPath(), nil, "")
	theirs := list["data"].([]any)[0].(map[string]any)
	docID := strconv.FormatInt(int64(theirs["id"].(float64)), 10)
	if rec, _ := e.call(outside, "GET", "/documents/"+docID+"/file", nil, ""); rec.Code != 200 {
		t.Fatalf("shared download = %d", rec.Code)
	}
	if rec, _ := e.call(outside, "DELETE", "/documents/"+docID, nil, ""); rec.Code != 403 {
		t.Fatalf("shared delete of a member's report = %d", rec.Code)
	}
	rec, up := e.upload(outside, "mine.pdf", pdf("2"))
	if rec.Code != 201 {
		t.Fatalf("shared upload = %d %s", rec.Code, rec.Body)
	}
	mine := strconv.FormatInt(int64(up["data"].(map[string]any)["id"].(float64)), 10)
	if rec, _ := e.call(outside, "DELETE", "/documents/"+mine, nil, ""); rec.Code != 200 {
		t.Fatalf("shared delete of own = %d", rec.Code)
	}
	// The share opens the folder only, not the project.
	if rec, _ := e.call(outside, "GET", "/projects/"+strconv.FormatInt(e.pid, 10)+"/members", nil, ""); rec.Code != 404 {
		t.Fatalf("shared members list = %d", rec.Code)
	}
	// Nor may they pass it on or see who else has it.
	if rec, _ := e.call(outside, "PUT", e.sharePath(8), nil, ""); rec.Code != 403 {
		t.Fatalf("re-share by a shared user = %d", rec.Code)
	}
	if rec, _ := e.call(outside, "GET", "/projects/"+strconv.FormatInt(e.pid, 10)+"/folder-shares", nil, ""); rec.Code != 403 {
		t.Fatalf("share list for a shared user = %d", rec.Code)
	}

	// Unsharing closes it again.
	if rec, _ := e.call(manager, "DELETE", e.sharePath(outside), nil, ""); rec.Code != 200 {
		t.Fatalf("unshare = %d", rec.Code)
	}
	if f := e.folders(t, outside); len(f) != 0 {
		t.Fatalf("after unshare the outsider sees %v", f)
	}
	if rec, _ := e.call(outside, "GET", "/documents/"+docID+"/file", nil, ""); rec.Code != 404 {
		t.Fatalf("download after unshare = %d", rec.Code)
	}
}

func TestShares_WhoMayShareAndWithWhom(t *testing.T) {
	e := newEnv(t)
	if rec, _ := e.call(viewer, "PUT", e.sharePath(outside), nil, ""); rec.Code != 403 {
		t.Fatalf("viewer share = %d", rec.Code)
	}
	if rec, _ := e.call(outside, "PUT", e.sharePath(7), nil, ""); rec.Code != 404 {
		t.Fatalf("outsider share = %d", rec.Code)
	}
	rec, b := e.call(member, "PUT", e.sharePath(other), nil, "")
	if rec.Code != 422 || b["fields"].(map[string]any)["userId"] != "already_member" {
		t.Fatalf("share with a member = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := e.call(member, "PUT", e.sharePath(99), nil, ""); rec.Code != 404 {
		t.Fatalf("share with an unknown user = %d", rec.Code)
	}
	for range 2 { // sharing twice is one share
		if rec, _ := e.call(manager, "PUT", e.sharePath(outside), nil, ""); rec.Code != 200 {
			t.Fatalf("share = %d", rec.Code)
		}
	}
	rec, b = e.call(member, "GET", "/projects/"+strconv.FormatInt(e.pid, 10)+"/folder-shares", nil, "")
	if list := b["data"].([]any); rec.Code != 200 || len(list) != 1 || list[0].(map[string]any)["sharedBy"].(float64) != float64(manager) {
		t.Fatalf("shares = %d %s", rec.Code, rec.Body)
	}

	// An archived project keeps its shares but they cannot change.
	if _, err := e.proj.Archive(context.Background(), manager, e.pid); err != nil {
		t.Fatal(err)
	}
	if rec, b := e.call(manager, "PUT", e.sharePath(8), nil, ""); rec.Code != 409 || b["error"] != "project_archived" {
		t.Fatalf("share on archived = %d %s", rec.Code, rec.Body)
	}
	if f := e.folders(t, outside)[e.pid]; f == nil || f["canUpload"] != false {
		t.Fatalf("archived shared folder = %v", f)
	}
}
