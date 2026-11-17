// Package auth identifies the caller. Production authentication is not wired
// yet; the local header authenticator exists only in -tags local builds.
package auth

import (
	"context"
	"net/http"

	"tracking-service/internal/apperr"
	"tracking-service/internal/httpx"
)

// Authenticator resolves the calling user id from a request.
type Authenticator interface {
	Authenticate(r *http.Request) (userID int64, err error)
}

type ctxKey struct{}

// Middleware rejects unauthenticated requests with the unauthorized envelope
// and otherwise stores the user id in the request context.
func Middleware(a Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, err := a.Authenticate(r)
			if err != nil {
				httpx.Fail(w, r, apperr.Unauthorized())
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
		})
	}
}

// UserID returns the authenticated user id, or 0 outside Middleware.
func UserID(ctx context.Context) int64 {
	id, _ := ctx.Value(ctxKey{}).(int64)
	return id
}
