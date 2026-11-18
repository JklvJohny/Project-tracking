// Package clock makes time injectable so tests control timestamps.
package clock

import "time"

// Clock returns the current time.
type Clock func() time.Time

// Fixed returns a Clock that always answers t.
func Fixed(t time.Time) Clock { return func() time.Time { return t } }

// UTC is the production clock: wall time in UTC, so every stored and emitted
// timestamp is UTC whatever the server's local zone.
func UTC() time.Time { return time.Now().UTC() }
