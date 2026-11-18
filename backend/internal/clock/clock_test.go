package clock_test

import (
	"testing"
	"time"

	"tracking-service/internal/clock"
)

// The API and docs/db-contract.md promise UTC timestamps ("...Z"), whatever
// the server's local zone.
func TestUTC_IsInUTC(t *testing.T) {
	if loc := clock.UTC().Location(); loc != time.UTC {
		t.Fatalf("location = %v", loc)
	}
}
