package httpx_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tracking-service/internal/httpx"
)

func etagReq(inm string, parts ...string) (*httptest.ResponseRecorder, bool) {
	req := httptest.NewRequest("GET", "/x", nil)
	if inm != "" {
		req.Header.Set("If-None-Match", inm)
	}
	rec := httptest.NewRecorder()
	nm := httpx.ETag(rec, req, parts...)
	return rec, nm
}

func TestETag_304OnMatch(t *testing.T) {
	rec, nm := etagReq("", "t1", "pm")
	tag := rec.Header().Get("ETag")
	if nm || !strings.HasPrefix(tag, `W/"`) || len(tag) != len(`W/""`)+16 {
		t.Fatalf("first: notModified=%v tag=%q", nm, tag)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-cache" {
		t.Fatalf("cache-control = %q", cc)
	}
	rec, nm = etagReq(tag, "t1", "pm")
	if !nm || rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatalf("match: notModified=%v code=%d body=%q", nm, rec.Code, rec.Body)
	}
	if _, nm = etagReq(`"other", `+tag, "t1", "pm"); !nm {
		t.Fatal("tag inside a list must match")
	}
	if _, nm = etagReq(`"nope"`, "t1", "pm"); nm {
		t.Fatal("different tag must not match")
	}
}

func TestETag_DiffersByRole(t *testing.T) {
	a, _ := etagReq("", "t1", "pm")
	b, _ := etagReq("", "t1", "viewer")
	if a.Header().Get("ETag") == b.Header().Get("ETag") {
		t.Fatal("role must change the etag")
	}
	// parts are not just concatenated: ("ab","c") != ("a","bc")
	c, _ := etagReq("", "ab", "c")
	d, _ := etagReq("", "a", "bc")
	if c.Header().Get("ETag") == d.Header().Get("ETag") {
		t.Fatal("part boundaries must matter")
	}
}
