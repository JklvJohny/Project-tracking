// Package rank generates LexoRank-style ordering keys. Keys are compared as
// raw bytes (PostgreSQL COLLATE "C"), so plain Go string comparison orders them.
package rank

import "errors"

const (
	alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	base     = len(alphabet)
	maxLen   = 48
)

// ErrNoGap means no key fits between the neighbours; callers rebalance with Spread.
var ErrNoGap = errors.New("rank: no gap between keys")

func digit(c byte) int {
	if c >= 'a' {
		return int(c-'a') + 10
	}
	return int(c - '0')
}

// Between returns a key k with a < k < b. Empty a means start, empty b means end.
// A key never ends in '0', so there is always room below any key.
func Between(a, b string) (string, error) {
	if a != "" && b != "" && a >= b {
		return "", ErrNoGap
	}
	var out []byte
	open := b == "" // upper bound no longer constrains once we pass below b
	for i := 0; ; i++ {
		da, db := 0, base // missing digit: a reads as 0, open b reads as 36
		if i < len(a) {
			da = digit(a[i])
		}
		if !open && i < len(b) {
			db = digit(b[i])
		}
		switch {
		case db-da >= 2:
			out = append(out, alphabet[(da+db)/2])
			if len(out) > maxLen {
				return "", ErrNoGap
			}
			return string(out), nil
		case da == db:
			out = append(out, alphabet[da])
		default: // db == da+1: stay on a's digit, b no longer binds
			out = append(out, alphabet[da])
			open = true
		}
		if len(out) > maxLen {
			return "", ErrNoGap
		}
	}
}

// Spread returns n ascending, equal-length, evenly spaced keys. The length is
// chosen so every gap and both ends keep room for many further Between calls.
func Spread(n int) []string {
	if n <= 0 {
		return nil
	}
	length, total := 2, uint64(base*base)
	for total < uint64(n+1)*uint64(base)*uint64(base) {
		length++
		total *= uint64(base)
	}
	keys := make([]string, n)
	for i := range keys {
		v := uint64(i+1) * (total / uint64(n+1))
		if v%uint64(base) == 0 {
			v++ // step >= 36*36, so this cannot reach the next key
		}
		buf := make([]byte, length)
		for j := length - 1; j >= 0; j-- {
			buf[j] = alphabet[v%uint64(base)]
			v /= uint64(base)
		}
		keys[i] = string(buf)
	}
	return keys
}
