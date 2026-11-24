package card_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/auth"
	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/httpx"
	"tracking-service/internal/project"
)

type headerAuth struct{}

func (headerAuth) Authenticate(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.Header.Get("X-User-ID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("no user")
	}
	return id, nil
}

func (e env) handler() http.Handler {
	return httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(headerAuth{}))
		project.Mount(r, e.proj)
		board.Mount(r, e.board)
		card.Mount(r, e.svc)
	})
}

func do(h http.Handler, user int64, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func id(n int64) string { return strconv.FormatInt(n, 10) }

func TestCardRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	ls := e.lists(t)
	c := e.mk(t, ls[0].ID, "c")
	for _, rc := range []struct{ method, path, body string }{
		{"GET", "/cards/" + id(c.ID), ""},
		{"PATCH", "/cards/" + id(c.ID), `{"title":"x"}`},
		{"POST", "/cards/" + id(c.ID) + "/move", `{"toListId":` + id(ls[1].ID) + `}`},
		{"POST", "/cards/" + id(c.ID) + "/archive", ""},
		{"POST", "/cards/" + id(c.ID) + "/restore", ""},
		{"PUT", "/cards/" + id(c.ID) + "/assignees/" + id(member), ""},
		{"DELETE", "/cards/" + id(c.ID) + "/assignees/" + id(member), ""},
		{"POST", "/lists/" + id(ls[0].ID) + "/cards", `{"title":"x"}`},
	} {
		rec, body := do(h, outside, rc.method, rc.path, rc.body)
		if rec.Code != 404 || body["code"] != "not_found" || body["data"] != nil {
			t.Errorf("%s %s = %d %s", rc.method, rc.path, rec.Code, rec.Body)
		}
	}
}

func TestHandlers_GetCardHasDescription_BoardDoesNot(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	l := e.lists(t)[0].ID
	rec, body := do(h, member, "POST", "/lists/"+id(l)+"/cards", `{"title":"c"}`)
	if rec.Code != 201 {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	cid := int64(body["data"].(map[string]any)["id"].(float64))
	if rec, _ = do(h, member, "PATCH", "/cards/"+id(cid), `{"descriptionMd":"secret body","priority":"urgent"}`); rec.Code != 200 {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	rec, body = do(h, member2, "GET", "/cards/"+id(cid), "")
	d := body["data"].(map[string]any)
	if rec.Code != 200 || d["descriptionMd"] != "secret body" || d["priority"] != "urgent" {
		t.Fatalf("get = %d %s", rec.Code, rec.Body)
	}
	for _, k := range []string{"id", "listId", "title", "descriptionMd", "priority", "startDate", "dueDate", "position",
		"completedAt", "createdAt", "updatedAt", "archivedAt", "assigneeIds", "labelIds", "checklist"} {
		if _, ok := d[k]; !ok {
			t.Errorf("missing %q", k)
		}
	}
	rec, _ = do(h, member, "GET", "/projects/"+id(e.pid)+"/board", "")
	if strings.Contains(rec.Body.String(), "secret body") || strings.Contains(rec.Body.String(), "descriptionMd") {
		t.Fatalf("board leaks description: %s", rec.Body)
	}
}

func TestHandlers_PatchNullClearsAbsentKeeps(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	p := "/cards/" + id(c.ID)
	if rec, _ := do(h, member, "PATCH", p, `{"dueDate":"2026-12-01","startDate":"2026-11-20"}`); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	_, body := do(h, member, "PATCH", p, `{"title":"t2"}`)
	d := body["data"].(map[string]any)
	if d["dueDate"] != "2026-12-01" || d["startDate"] != "2026-11-20" || d["title"] != "t2" {
		t.Fatalf("absent changed: %v", d)
	}
	_, body = do(h, member, "PATCH", p, `{"dueDate":null}`)
	d = body["data"].(map[string]any)
	if d["dueDate"] != nil || d["startDate"] != "2026-11-20" {
		t.Fatalf("null: %v", d)
	}
	if rec, _ := do(h, member, "PATCH", p, `{"title":"x","bogus":1}`); rec.Code != 400 {
		t.Fatalf("unknown field = %d", rec.Code)
	}
}

func TestHandlers_MoveAndAssignRoutes(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	ls := e.lists(t)
	c := e.mk(t, ls[0].ID, "c")
	rec, body := do(h, member, "POST", "/cards/"+id(c.ID)+"/move", `{"toListId":`+id(ls[1].ID)+`}`)
	if rec.Code != 200 || int64(body["data"].(map[string]any)["listId"].(float64)) != ls[1].ID {
		t.Fatalf("move = %d %s", rec.Code, rec.Body)
	}
	rec, body = do(h, member, "PUT", "/cards/"+id(c.ID)+"/assignees/"+id(member), "")
	if rec.Code != 200 || len(body["data"].(map[string]any)["assigneeIds"].([]any)) != 1 {
		t.Fatalf("assign = %d %s", rec.Code, rec.Body)
	}
	rec, _ = do(h, member, "PUT", "/cards/"+id(c.ID)+"/assignees/"+id(outside), "")
	if rec.Code != 422 {
		t.Fatalf("assign non-member = %d", rec.Code)
	}
	rec, body = do(h, member, "DELETE", "/cards/"+id(c.ID)+"/assignees/"+id(member), "")
	if rec.Code != 200 || len(body["data"].(map[string]any)["assigneeIds"].([]any)) != 0 {
		t.Fatalf("unassign = %d %s", rec.Code, rec.Body)
	}
}
