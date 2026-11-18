package users

import (
	"context"
	"strings"
)

type stub struct{ all []User }

// NewStub returns 8 fixed users (ids 1-8) until user-service is wired.
func NewStub() Provider {
	names := []string{"สมชาย ใจดี", "Napat K.", "วิภา รักงาน", "Somsak P.", "ปิยะ มั่นคง", "Mali S.", "ธนากร ทองดี", "Anan T."}
	s := &stub{}
	for i, n := range names {
		s.all = append(s.all, User{ID: int64(i + 1), Name: n})
	}
	return s
}

func (s *stub) Get(_ context.Context, ids []int64) ([]User, error) {
	out := []User{}
	for _, id := range ids {
		if id >= 1 && int(id) <= len(s.all) {
			out = append(out, s.all[id-1])
		}
	}
	return out, nil
}

func (s *stub) Search(_ context.Context, q string, limit int) ([]User, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	out := []User{}
	for _, u := range s.all {
		if len(out) >= limit {
			break
		}
		if strings.Contains(strings.ToLower(u.Name), q) {
			out = append(out, u)
		}
	}
	return out, nil
}
