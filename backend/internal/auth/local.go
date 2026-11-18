//go:build local

package auth

import (
	"errors"
	"net/http"
	"strconv"
)

type local struct{}

// NewLocal trusts the X-User-ID header. It must never exist in a production
// build, hence the build tag.
func NewLocal() Authenticator { return local{} }

func (local) Authenticate(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.Header.Get("X-User-ID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("missing or invalid X-User-ID")
	}
	return id, nil
}
