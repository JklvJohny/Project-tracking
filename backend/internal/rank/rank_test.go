package rank

import (
	"errors"
	"math/rand"
	"sort"
	"strings"
	"testing"
)

func TestBetween_OpenEnds(t *testing.T) {
	k, err := Between("", "")
	if err != nil || k == "" {
		t.Fatalf("got %q, %v", k, err)
	}
}

func TestBetween_Ordering(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	var keys []string
	for i := 0; i < 1000; i++ {
		pos := r.Intn(len(keys) + 1) // 0 = front, len = back, else middle
		a, b := "", ""
		if pos > 0 {
			a = keys[pos-1]
		}
		if pos < len(keys) {
			b = keys[pos]
		}
		k, err := Between(a, b)
		if errors.Is(err, ErrNoGap) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if (a != "" && k <= a) || (b != "" && k >= b) {
			t.Fatalf("%q not between %q and %q", k, a, b)
		}
		keys = append(keys[:pos], append([]string{k}, keys[pos:]...)...)
	}
	if !sort.StringsAreSorted(keys) {
		t.Fatal("keys not sorted")
	}
}

func TestBetween_NeverEndsInZero(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	var keys []string
	for i := 0; i < 1000; i++ {
		pos := r.Intn(len(keys) + 1)
		a, b := "", ""
		if pos > 0 {
			a = keys[pos-1]
		}
		if pos < len(keys) {
			b = keys[pos]
		}
		k, err := Between(a, b)
		if err != nil {
			continue
		}
		if strings.HasSuffix(k, "0") {
			t.Fatalf("%q ends in 0", k)
		}
		keys = append(keys[:pos], append([]string{k}, keys[pos:]...)...)
	}
}

func TestBetween_SameKeyIsNoGap(t *testing.T) {
	for _, c := range [][2]string{{"m", "m"}, {"n", "m"}} {
		if _, err := Between(c[0], c[1]); !errors.Is(err, ErrNoGap) {
			t.Fatalf("Between(%q,%q) err = %v", c[0], c[1], err)
		}
	}
}

func TestBetween_RepeatedInsertAtSameSpotHitsNoGapEventually(t *testing.T) {
	left, _ := Between("", "")
	newest, err := Between(left, "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10000; i++ {
		k, err := Between(left, newest)
		if errors.Is(err, ErrNoGap) {
			return
		}
		if err != nil {
			t.Fatal(err)
		}
		if len(k) > maxLen {
			t.Fatalf("key %q longer than %d", k, maxLen)
		}
		if k <= left || k >= newest {
			t.Fatalf("%q not between %q and %q", k, left, newest)
		}
		newest = k
	}
	t.Fatal("never hit ErrNoGap")
}

func TestSpread(t *testing.T) {
	keys := Spread(5)
	if len(keys) != 5 {
		t.Fatalf("len %d", len(keys))
	}
	for i, k := range keys {
		if len(k) != len(keys[0]) {
			t.Fatalf("unequal length %q", k)
		}
		if strings.HasSuffix(k, "0") {
			t.Fatalf("%q ends in 0", k)
		}
		if i > 0 && k <= keys[i-1] {
			t.Fatalf("not ascending: %v", keys)
		}
	}
	// Room must remain on both sides and between neighbours.
	if _, err := Between("", keys[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := Between(keys[4], ""); err != nil {
		t.Fatal(err)
	}
	if _, err := Between(keys[0], keys[1]); err != nil {
		t.Fatal(err)
	}
}
