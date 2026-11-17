//go:build !local

package auth

// NewLocal is nil in builds without -tags local, so main can refuse ENV=local.
func NewLocal() Authenticator { return nil }
