package httpx_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/httpx"
)

type envelope struct {
	Success bool              `json:"success"`
	Error   string            `json:"error"`
	Code    string            `json:"code"`
	Fields  map[string]string `json:"fields"`
}

func failWith(t *testing.T, err error) (*httptest.ResponseRecorder, envelope) {
	t.Helper()
	rec := httptest.NewRecorder()
	httpx.Fail(rec, httptest.NewRequest(http.MethodGet, "/", nil), err)
	var env envelope
	if e := json.Unmarshal(rec.Body.Bytes(), &env); e != nil {
		t.Fatalf("bad json %q: %v", rec.Body.String(), e)
	}
	return rec, env
}

func TestFail_AppErrorMapsStatus(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{apperr.BadRequest("x"), 400, "bad_request"},
		{apperr.Unauthorized(), 401, "unauthorized"},
		{apperr.Forbidden(), 403, "forbidden"},
		{apperr.NotFound("card"), 404, "not_found"},
		{apperr.Conflict("x"), 409, "conflict"},
		{apperr.Validation(map[string]string{"name": "required"}), 422, "validation_failed"},
		{&apperr.Error{Code: "server_error", Msg: "boom"}, 500, "server_error"},
	}
	for _, c := range cases {
		rec, env := failWith(t, c.err)
		if rec.Code != c.status || env.Code != c.code || env.Success {
			t.Errorf("%s: got %d %+v", c.code, rec.Code, env)
		}
	}
}

func TestFail_ValidationIncludesFields(t *testing.T) {
	in := map[string]string{"name": "required", "end": "before_start"}
	_, env := failWith(t, apperr.Validation(in))
	if len(env.Fields) != 2 || env.Fields["name"] != "required" || env.Fields["end"] != "before_start" {
		t.Fatalf("fields = %v", env.Fields)
	}
}

func TestFail_UnknownErrorIs500AndHidesMessage(t *testing.T) {
	rec, env := failWith(t, errors.New("secret db detail"))
	if rec.Code != 500 || env.Code != "server_error" || env.Error != "internal error" {
		t.Fatalf("got %d %+v", rec.Code, env)
	}
}

func TestDecode_RejectsUnknownField(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"a":1,"zzz":2}`))
	r.Header.Set("Content-Type", "application/json")
	var dst struct {
		A int `json:"a"`
	}
	err := httpx.Decode(r, &dst)
	var ae *apperr.Error
	if !errors.As(err, &ae) || ae.Code != "bad_request" {
		t.Fatalf("err = %v", err)
	}
}

func TestRouter_Healthz(t *testing.T) {
	h := httpx.NewRouter(func(chi.Router) {})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != `{"success":true,"data":{"status":"ok"}}` {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestRouter_PanicReturnsJSON500(t *testing.T) {
	h := httpx.NewRouter(func(r chi.Router) {
		r.Get("/boom", func(http.ResponseWriter, *http.Request) { panic("kaboom") })
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tracking/v1/boom", nil))
	var env envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if rec.Code != 500 || env.Code != "server_error" || env.Success {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestRouter_UnknownRouteIsEnvelope404(t *testing.T) {
	h := httpx.NewRouter(func(chi.Router) {})
	for _, path := range []string{"/nope", "/api/tracking/v1/nope"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		var env envelope
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		if rec.Code != 404 || env.Code != "not_found" || env.Success {
			t.Fatalf("%s: got %d %q", path, rec.Code, rec.Body.String())
		}
	}
}

func TestRouter_WrongMethodIsEnvelope400(t *testing.T) {
	h := httpx.NewRouter(func(r chi.Router) {
		r.Get("/thing", func(http.ResponseWriter, *http.Request) {})
	})
	for _, path := range []string{"/healthz", "/api/tracking/v1/thing"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, path, nil))
		var env envelope
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		if rec.Code != 400 || env.Code != "bad_request" || env.Success {
			t.Fatalf("%s: got %d %q", path, rec.Code, rec.Body.String())
		}
	}
}

// A body not declared as JSON is refused even when it parses: an HTML form on
// another site can post text/plain that reads as JSON.
func TestDecode_RequiresJSONContentType(t *testing.T) {
	for ct, ok := range map[string]bool{
		"application/json":                true,
		"application/json; charset=utf-8": true,
		"text/plain":                      false,
		"":                                false,
	} {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"a":1}`))
		if ct != "" {
			r.Header.Set("Content-Type", ct)
		}
		var dst struct {
			A int `json:"a"`
		}
		if err := httpx.Decode(r, &dst); (err == nil) != ok {
			t.Errorf("Content-Type %q: err = %v", ct, err)
		}
	}
}

// A browser write on behalf of another site is refused before any handler
// runs; reads, same-site writes and clients without the header pass.
func TestRouter_RefusesCrossSiteWrites(t *testing.T) {
	h := httpx.NewRouter(func(r chi.Router) {
		r.Get("/x", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		r.Post("/x", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	})
	for _, c := range []struct {
		method, site string
		want         int
	}{
		{http.MethodPost, "cross-site", http.StatusForbidden},
		{http.MethodPost, "same-origin", http.StatusNoContent},
		{http.MethodPost, "", http.StatusNoContent},
		{http.MethodGet, "cross-site", http.StatusNoContent},
	} {
		req := httptest.NewRequest(c.method, "/api/tracking/v1/x", nil)
		if c.site != "" {
			req.Header.Set("Sec-Fetch-Site", c.site)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s = %d, want %d", c.method, c.site, rec.Code, c.want)
		}
	}
}
