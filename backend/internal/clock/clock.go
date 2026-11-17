// Package clock makes time injectable so tests control timestamps.
package clock

import "time"

// Clock returns the current time.
type Clock func() time.Time

// Fixed returns a Clock that always answers t.
func Fixed(t time.Time) Clock { return func() time.Time { return t } }
