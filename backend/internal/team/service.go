// Package team serves the Team page: everyone in the department with the
// skills they list and how much open work they carry, so a PM can pick who
// fits a piece of work.
package team

import (
	"context"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"tracking-service/internal/apperr"
	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
)

const (
	maxSkills = 30
	maxSkill  = 40
	// maxPeople caps the directory read; one department is far smaller.
	maxPeople = 500
	soonDays  = 7
)

// bangkok is the business zone ("today" is a Bangkok date), as on the dashboard.
var bangkok = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*60*60)
}()

type Service struct {
	st  store.Store
	up  users.Provider
	now clock.Clock
}

func New(st store.Store, up users.Provider, now clock.Clock) *Service {
	return &Service{st: st, up: up, now: now}
}

// Person is one card on the Team page. Open counts every open card assigned to
// them across all live projects: a total, not the cards, so it is shown to
// everyone without revealing projects the caller cannot see.
type Person struct {
	UserID    int64    `json:"userId"`
	Name      string   `json:"name"`
	AvatarURL string   `json:"avatarUrl"`
	Skills    []string `json:"skills"`
	Open      int      `json:"open"`
	Overdue   int      `json:"overdue"`
	DueSoon   int      `json:"dueSoon"`
}

type View struct {
	AsOf   string   `json:"asOf"`
	People []Person `json:"people"`
}

// List returns the department's people (from user-service) by name.
func (s *Service) List(ctx context.Context) (View, error) {
	now := s.now().In(bangkok)
	today := store.Date(now.Format(time.DateOnly))
	soon := store.Date(now.AddDate(0, 0, soonDays).Format(time.DateOnly))
	people, err := s.up.Department(ctx, maxPeople)
	if err != nil {
		return View{}, err
	}
	var skills map[int64][]string
	var load map[int64]store.Workload
	err = s.st.View(ctx, func(r store.Repos) error {
		if skills, err = r.Team.Skills(ctx); err != nil {
			return err
		}
		load, err = r.Team.Workload(ctx, today, soon)
		return err
	})
	if err != nil {
		return View{}, err
	}
	out := View{AsOf: string(today), People: make([]Person, 0, len(people))}
	for _, u := range people {
		sk := skills[u.ID]
		if sk == nil {
			sk = []string{}
		}
		w := load[u.ID]
		out.People = append(out.People, Person{
			UserID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL, Skills: sk,
			Open: w.Open, Overdue: w.Overdue, DueSoon: w.DueSoon,
		})
	}
	sort.SliceStable(out.People, func(i, j int) bool {
		return strings.ToLower(out.People[i].Name) < strings.ToLower(out.People[j].Name)
	})
	return out, nil
}

// SetSkills replaces userID's skills. Anyone signed in may edit anyone's (the
// department keeps the list together); the person must exist in user-service.
func (s *Service) SetSkills(ctx context.Context, userID int64, raw []string) ([]string, error) {
	skills, err := cleanSkills(raw)
	if err != nil {
		return nil, err
	}
	found, err := s.up.Get(ctx, []int64{userID})
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, apperr.NotFound("user")
	}
	err = s.st.Update(ctx, func(r store.Repos) error {
		return r.Team.SetSkills(ctx, userID, skills)
	})
	if err != nil {
		return nil, err
	}
	return skills, nil
}

// cleanSkills trims each tag, squeezes inner spaces, drops blanks and keeps
// the first spelling of a case-insensitive duplicate, in the order given.
func cleanSkills(raw []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range raw {
		s = strings.Join(strings.Fields(s), " ")
		if s == "" {
			continue
		}
		if utf8.RuneCountInString(s) > maxSkill {
			return nil, apperr.Validation(map[string]string{"skills": "too_long"})
		}
		key := strings.ToLower(s)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
	}
	if len(out) > maxSkills {
		return nil, apperr.Validation(map[string]string{"skills": "too_many"})
	}
	return out, nil
}
