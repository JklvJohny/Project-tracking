// Package validate holds the shared field checks. Each records a stable code
// in fields; the caller answers apperr.Validation(fields) if any exist.
package validate

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"tracking-service/internal/store"
)

// Text trims s and records "required" or "too_long" (counted in runes, so
// Thai is not penalised for multi-byte characters). It returns the trimmed text.
func Text(field, s string, max int, fields map[string]string) string {
	s = strings.TrimSpace(s)
	switch {
	case s == "":
		fields[field] = "required"
	case utf8.RuneCountInString(s) > max:
		fields[field] = "too_long"
	}
	return s
}

// Date parses an optional YYYY-MM-DD value. A nil input means "not given" and
// yields nil; anything unparseable records "invalid_date".
func Date(field string, s *string, fields map[string]string) *store.Date {
	if s == nil {
		return nil
	}
	if _, err := time.Parse("2006-01-02", *s); err != nil {
		fields[field] = "invalid_date"
		return nil
	}
	d := store.Date(*s)
	return &d
}

// DateOrder records "before_start" under endField when end is earlier than
// start. The first parameter names the later field (end or due), because
// that is where the error belongs. Nil dates are skipped.
func DateOrder(endField string, start, end *store.Date, fields map[string]string) {
	if start != nil && end != nil && *end < *start { // YYYY-MM-DD sorts lexically
		fields[endField] = "before_start"
	}
}

// OptDate tells an absent JSON key (Set false: leave the date alone) from
// null (Set, nil Value: clear it) and from a string (Set, non-nil: replace).
type OptDate struct {
	Set   bool
	Value *string
}

// SetDate builds an OptDate that is present; nil clears.
func SetDate(v *string) OptDate { return OptDate{Set: true, Value: v} }

func (o *OptDate) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}
