package httpx

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

// ETag sets a weak ETag derived from parts, plus Cache-Control: private,
// no-cache (clients always revalidate; shared caches never store it). When the
// request's If-None-Match already holds that tag it writes 304 with no body
// and returns true; the caller must then return without writing anything.
func ETag(w http.ResponseWriter, r *http.Request, parts ...string) (notModified bool) {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0}) // separator, so ("ab","c") and ("a","bc") differ
	}
	tag := `W/"` + hex.EncodeToString(h.Sum(nil))[:16] + `"`
	w.Header().Set("ETag", tag)
	w.Header().Set("Cache-Control", "private, no-cache")
	for _, c := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		c = strings.TrimSpace(c)
		if c == "*" || strings.TrimPrefix(c, "W/") == strings.TrimPrefix(tag, "W/") {
			w.WriteHeader(http.StatusNotModified)
			return true
		}
	}
	return false
}
