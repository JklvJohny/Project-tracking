//go:build local

package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"tracking-service/internal/auth"
)

func TestLocal_HeaderAuth(t *testing.T) {
	a := auth.NewLocal()
	req := func(h string, set bool) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		if set {
			r.Header.Set("X-User-ID", h)
		}
		return r
	}
	if id, err := a.Authenticate(req("3", true)); err != nil || id != 3 {
		t.Fatalf("got %d, %v", id, err)
	}
	for _, c := range []struct {
		v   string
		set bool
	}{{"", false}, {"abc", true}, {"0", true}, {"-2", true}} {
		if _, err := a.Authenticate(req(c.v, c.set)); err == nil {
			t.Errorf("header %q set=%v: want error", c.v, c.set)
		}
	}
}

func TestMiddleware_UnauthorizedEnvelopeAndContext(t *testing.T) {
	var got int64
	h := auth.Middleware(auth.NewLocal())(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = auth.UserID(r.Context())
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != 401 {
		t.Fatalf("status %d", rec.Code)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("X-User-ID", "5")
	h.ServeHTTP(httptest.NewRecorder(), r)
	if got != 5 {
		t.Fatalf("user id %d", got)
	}
}
