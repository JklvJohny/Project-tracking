package board_test

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
		project.Mount(r, e.proj) // both modules share /projects/{projectID}
		board.Mount(r, e.svc)
	})
}

func do(h http.Handler, user int64, method, path, body string, hdr ...string) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestBoardHandler_SecondGetWithIfNoneMatchIs304(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	path := "/projects/" + strconv.FormatInt(e.pid, 10) + "/board"

	rec, body := do(h, member, "GET", path, "")
	tag := rec.Header().Get("ETag")
	if rec.Code != 200 || tag == "" || body["success"] != true {
		t.Fatalf("first = %d etag=%q %s", rec.Code, tag, rec.Body)
	}
	data := body["data"].(map[string]any)
	for _, k := range []string{"board", "project", "myRole", "lists", "cards", "labels", "members", "users"} {
		if _, ok := data[k]; !ok {
			t.Errorf("missing %q", k)
		}
	}
	rec, _ = do(h, member, "GET", path, "", "If-None-Match", tag)
	if rec.Code != 304 || rec.Body.Len() != 0 {
		t.Fatalf("second = %d body=%q", rec.Code, rec.Body)
	}
	// same board, different role: another role's tag must not match
	rec, _ = do(h, viewer, "GET", path, "", "If-None-Match", tag)
	if rec.Code != 200 {
		t.Fatalf("viewer with member's tag = %d", rec.Code)
	}
	if rec, _ = do(h, outside, "GET", path, ""); rec.Code != 404 {
		t.Fatalf("outsider = %d", rec.Code)
	}
}

func TestBoardHandler_WriteChangesETag(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	pid := strconv.FormatInt(e.pid, 10)
	rec, _ := do(h, manager, "GET", "/projects/"+pid+"/board", "")
	tag := rec.Header().Get("ETag")

	*e.tick = 1
	rec, body := do(h, manager, "POST", "/projects/"+pid+"/lists", `{"name":"Extra"}`)
	if rec.Code != 201 || body["data"].(map[string]any)["name"] != "Extra" {
		t.Fatalf("create list = %d %s", rec.Code, rec.Body)
	}
	rec, _ = do(h, manager, "GET", "/projects/"+pid+"/board", "", "If-None-Match", tag)
	if rec.Code != 200 || rec.Header().Get("ETag") == tag {
		t.Fatalf("after write = %d etag %q (old %q)", rec.Code, rec.Header().Get("ETag"), tag)
	}
}

func TestListHandlers_Flow(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	ls := e.lists(t)
	id := func(i int) string { return strconv.FormatInt(ls[i].ID, 10) }
	lid := id(3)

	rec, body := do(h, manager, "PATCH", "/lists/"+lid, `{"name":"Shipped","isDone":true}`)
	if rec.Code != 200 || body["data"].(map[string]any)["name"] != "Shipped" {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, manager, "POST", "/lists/"+lid+"/move", `{"beforeId":`+id(0)+`,"afterId":`+id(1)+`}`); rec.Code != 200 {
		t.Fatalf("move = %d %s", rec.Code, rec.Body)
	}
	rec, body = do(h, manager, "POST", "/lists/"+lid+"/move", `{"beforeId":`+id(1)+`,"afterId":`+id(0)+`}`)
	if rec.Code != 409 || body["error"] != "stale_order" || body["code"] != "conflict" {
		t.Fatalf("stale move = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, manager, "POST", "/lists/"+lid+"/archive", ""); rec.Code != 200 {
		t.Fatalf("archive = %d %s", rec.Code, rec.Body)
	}
	rec, body = do(h, viewer, "GET", "/projects/"+strconv.FormatInt(e.pid, 10)+"/archived", "")
	d, _ := body["data"].(map[string]any)
	if rec.Code != 200 || len(d["lists"].([]any)) != 1 || len(d["cards"].([]any)) != 0 {
		t.Fatalf("archived = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, manager, "POST", "/lists/"+lid+"/restore", ""); rec.Code != 200 {
		t.Fatalf("restore = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, member, "PATCH", "/lists/"+lid, `{"name":"x"}`); rec.Code != 403 {
		t.Fatalf("member patch = %d", rec.Code)
	}
	if rec, _ = do(h, outside, "PATCH", "/lists/"+lid, `{"name":"x"}`); rec.Code != 404 {
		t.Fatalf("outsider patch = %d", rec.Code)
	}
	if rec, _ = do(h, manager, "PATCH", "/lists/"+lid, `{"bogus":1}`); rec.Code != 400 {
		t.Fatalf("unknown field = %d", rec.Code)
	}
}

// The board payload carries the project name, status and archivedAt, so
// project writes must change the board ETag.
func TestBoardHandler_ProjectWritesChangeETag(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	pid := strconv.FormatInt(e.pid, 10)
	etag := func() string {
		rec, _ := do(h, manager, "GET", "/projects/"+pid+"/board", "")
		return rec.Header().Get("ETag")
	}
	steps := []struct{ method, path, body string }{
		{"PATCH", "/projects/" + pid, `{"name":"Renamed"}`},
		{"PATCH", "/projects/" + pid, `{"status":"on_hold"}`},
		{"POST", "/projects/" + pid + "/archive", ""},
		{"POST", "/projects/" + pid + "/restore", ""},
	}
	prev := etag()
	for i, st := range steps {
		*e.tick = i + 1
		if rec, _ := do(h, manager, st.method, st.path, st.body); rec.Code != 200 {
			t.Fatalf("%s %s = %d %s", st.method, st.path, rec.Code, rec.Body)
		}
		cur := etag()
		if cur == prev {
			t.Fatalf("%s %s did not change the board ETag", st.method, st.path)
		}
		prev = cur
	}
}
