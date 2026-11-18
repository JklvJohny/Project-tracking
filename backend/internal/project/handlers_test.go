package project_test

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
		project.Mount(r, e.svc)
	})
}

func call(h http.Handler, user int64, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, strings.NewReader(body))
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestHandlers_ProjectsRoundTrip(t *testing.T) {
	e := newEnv(t)
	h := e.handler()

	rec, body := call(h, manager, "POST", "/projects", `{"name":"Website","lang":"en","startDate":"2026-12-01"}`)
	if rec.Code != 201 || body["success"] != true {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	data := body["data"].(map[string]any)
	id := int64(data["id"].(float64))
	for _, k := range []string{"id", "name", "description", "ownerId", "status", "startDate", "endDate", "createdAt", "updatedAt", "archivedAt", "myRole"} {
		if _, ok := data[k]; !ok {
			t.Errorf("missing key %q in %v", k, data)
		}
	}

	rec, body = call(h, manager, "GET", "/projects", "")
	list := body["data"].([]any)
	if rec.Code != 200 || len(list) != 1 || list[0].(map[string]any)["myRole"] != "pm" {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}

	base := "/projects/" + strconv.FormatInt(id, 10)
	if rec, _ = call(h, manager, "PATCH", base, `{"description":"d"}`); rec.Code != 200 {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "POST", base+"/members", `{"userId":3,"role":"viewer"}`); rec.Code != 201 {
		t.Fatalf("add member = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "PATCH", base+"/members/3", `{"role":"member"}`); rec.Code != 200 {
		t.Fatalf("set role = %d %s", rec.Code, rec.Body)
	}
	if rec, body = call(h, 3, "GET", base+"/members", ""); rec.Code != 200 || len(body["data"].([]any)) != 2 {
		t.Fatalf("members = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "DELETE", base+"/members/3", ""); rec.Code != 200 {
		t.Fatalf("remove = %d %s", rec.Code, rec.Body)
	}
	if rec, body = call(h, 3, "GET", base, ""); rec.Code != 404 || body["code"] != "not_found" {
		t.Fatalf("ex-member get = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "POST", base+"/archive", ""); rec.Code != 200 {
		t.Fatalf("archive = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, manager, "POST", base+"/restore", ""); rec.Code != 200 {
		t.Fatalf("restore = %d %s", rec.Code, rec.Body)
	}
	rec, body = call(h, manager, "PATCH", base, `{"endDate":"2026-01-01"}`)
	if rec.Code != 422 || body["fields"].(map[string]any)["endDate"] != "before_start" {
		t.Fatalf("validation = %d %s", rec.Code, rec.Body)
	}
}

func TestHandlers_MeUsersAndAuth(t *testing.T) {
	e := newEnv(t)
	h := e.handler()

	rec, body := call(h, admin, "GET", "/me", "")
	d, _ := body["data"].(map[string]any)
	if rec.Code != 200 || d["isAdmin"] != true || d["canCreateProject"] != true || d["user"].(map[string]any)["id"] != float64(admin) {
		t.Fatalf("me = %d %s", rec.Code, rec.Body)
	}
	rec, body = call(h, admin, "GET", "/users?q=mali", "")
	if rec.Code != 200 || len(body["data"].([]any)) != 1 {
		t.Fatalf("users = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = call(h, regular, "POST", "/projects", `{"name":"x","lang":"en"}`); rec.Code != 403 {
		t.Fatalf("regular create = %d", rec.Code)
	}
	if rec, _ = call(h, admin, "POST", "/projects", `{"name":"x","bogus":1}`); rec.Code != 400 {
		t.Fatalf("unknown field = %d", rec.Code)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/tracking/v1/projects", nil))
	if w.Code != 401 {
		t.Fatalf("no auth = %d", w.Code)
	}
}

// R15: null clears a date (as for cards); "" still clears; an absent key
// leaves it alone.
func TestHandlers_PatchDateNullClears(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	_, body := call(h, manager, "POST", "/projects", `{"name":"W","lang":"en","startDate":"2026-12-01","endDate":"2026-12-20"}`)
	base := "/projects/" + strconv.FormatInt(int64(body["data"].(map[string]any)["id"].(float64)), 10)

	rec, body := call(h, manager, "PATCH", base, `{"startDate":null}`)
	d, _ := body["data"].(map[string]any)
	if rec.Code != 200 || d["startDate"] != nil || d["endDate"] != "2026-12-20" {
		t.Fatalf("null = %d %s", rec.Code, rec.Body)
	}
	rec, body = call(h, manager, "PATCH", base, `{"endDate":""}`)
	d, _ = body["data"].(map[string]any)
	if rec.Code != 200 || d["endDate"] != nil {
		t.Fatalf("empty = %d %s", rec.Code, rec.Body)
	}
	rec, body = call(h, manager, "PATCH", base, `{"startDate":"2026-12-02"}`)
	d, _ = body["data"].(map[string]any)
	if rec.Code != 200 || d["startDate"] != "2026-12-02" {
		t.Fatalf("set = %d %s", rec.Code, rec.Body)
	}
}
