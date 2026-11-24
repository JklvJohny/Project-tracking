package validate_test

import (
	"maps"
	"strings"
	"testing"

	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

func TestText_ThaiRunes(t *testing.T) {
	f := map[string]string{}
	ok := strings.Repeat("ก", 200)
	if got := validate.Text("title", ok, 200, f); got != ok || len(f) != 0 {
		t.Fatalf("200 runes: %v", f)
	}
	validate.Text("title", ok+"ก", 200, f)
	if f["title"] != "too_long" {
		t.Fatalf("201 runes: %v", f)
	}
}

func TestText_TrimmedEmptyIsRequired(t *testing.T) {
	f := map[string]string{}
	if got := validate.Text("name", " \t\n ", 10, f); got != "" || f["name"] != "required" {
		t.Fatalf("got %q %v", got, f)
	}
	f = map[string]string{}
	if got := validate.Text("name", "  hi ", 10, f); got != "hi" || len(f) != 0 {
		t.Fatalf("got %q %v", got, f)
	}
}

func TestDate(t *testing.T) {
	f := map[string]string{}
	good, bad := "2026-02-28", "2026-02-30"
	if d := validate.Date("start", &good, f); d == nil || *d != "2026-02-28" {
		t.Fatalf("good: %v", d)
	}
	if d := validate.Date("end", &bad, f); d != nil || f["end"] != "invalid_date" {
		t.Fatalf("bad: %v %v", d, f)
	}
	if validate.Date("x", nil, f) != nil || len(f) != 1 {
		t.Fatal("nil must be ignored")
	}
}

func TestDateOrder_DueBeforeStart(t *testing.T) {
	s, e := store.Date("2026-03-10"), store.Date("2026-03-09")
	f := map[string]string{}
	validate.DateOrder("due", &s, &e, f)
	if f["due"] != "before_start" {
		t.Fatalf("got %v", f)
	}
	f = map[string]string{}
	validate.DateOrder("due", &s, &s, f)
	validate.DateOrder("due", nil, &e, f)
	if len(f) != 0 {
		t.Fatalf("equal/nil must pass: %v", f)
	}
}

// PostgreSQL rejects NUL and invalid UTF-8 in text, and year 0 in a date: the
// service must answer validation_failed, not let the insert fail with a 500.
func TestUnstorableInputIsInvalid(t *testing.T) {
	fields := map[string]string{}
	validate.Text("title", "a\x00b", 200, fields)
	validate.Text("name", "a\xffb", 200, fields)
	validate.LongText("description", "ok\x00", 20000, fields)
	validate.LongText("note", "", 20000, fields) // empty is fine for long text
	zero := "0000-01-01"
	if validate.Date("startDate", &zero, fields) != nil {
		t.Error("year 0 parsed")
	}
	want := map[string]string{"title": "invalid", "name": "invalid", "description": "invalid", "startDate": "invalid_date"}
	if !maps.Equal(fields, want) {
		t.Fatalf("fields = %v, want %v", fields, want)
	}
	if !validate.Storable("ภาษาไทย ✓") {
		t.Error("Thai text refused")
	}
}
