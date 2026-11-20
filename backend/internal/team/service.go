// Package team serves the Team page: everyone in the department with the
// skills they list and how much open work they carry, so a PM can pick who
// fits a piece of work.
package team

import (
	"context"
	"errors"
	"slices"
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
	// maxCategories keeps the skill bar one screen tall.
	maxCategories = 50
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
	// Catalog is the skills the department has named, including ones nobody
	// lists yet, by name ignoring case. A skill only on people's cards and in
	// no category is not listed.
	Catalog []CatalogEntry `json:"catalog"`
	// Categories are in the order they were made.
	Categories []Category `json:"categories"`
}

type CatalogEntry struct {
	Name string `json:"name"`
	// CategoryID is null for an uncategorised skill.
	CategoryID *int64 `json:"categoryId"`
}

type Category struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
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
	var catalog []store.CatalogSkill
	var cats []store.SkillCategory
	err = s.st.View(ctx, func(r store.Repos) error {
		if skills, err = r.Team.Skills(ctx); err != nil {
			return err
		}
		if catalog, err = r.Team.Catalog(ctx); err != nil {
			return err
		}
		if cats, err = r.Team.Categories(ctx); err != nil {
			return err
		}
		load, err = r.Team.Workload(ctx, today, soon)
		return err
	})
	if err != nil {
		return View{}, err
	}
	out := View{
		AsOf: string(today), People: make([]Person, 0, len(people)),
		Catalog: make([]CatalogEntry, 0, len(catalog)), Categories: make([]Category, 0, len(cats)),
	}
	for _, c := range catalog {
		out.Catalog = append(out.Catalog, CatalogEntry{Name: c.Name, CategoryID: c.CategoryID})
	}
	for _, c := range cats {
		out.Categories = append(out.Categories, Category{ID: c.ID, Name: c.Name})
	}
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

// AddSkill names a skill for the department and, optionally, gives it to the
// listed people and puts it in categoryID, in the same transaction. Adding a
// name that exists (ignoring case) is not an error: the people still get it,
// under the existing spelling, and a given category moves it. Anyone signed
// in may add.
func (s *Service) AddSkill(ctx context.Context, caller int64, raw string, userIDs []int64, categoryID *int64) (View, error) {
	name, err := cleanSkill(raw)
	if err != nil {
		return View{}, err
	}
	if len(userIDs) > 0 {
		found, err := s.up.Get(ctx, uniq(userIDs))
		if err != nil {
			return View{}, err
		}
		if len(found) != len(uniq(userIDs)) {
			return View{}, apperr.Validation(map[string]string{"userIds": "unknown"})
		}
	}
	err = s.st.Update(ctx, func(r store.Repos) error {
		if err := categoryExists(ctx, r, categoryID); err != nil {
			return err
		}
		entry := store.CatalogSkill{Name: name, CategoryID: categoryID, CreatedBy: caller, CreatedAt: s.now()}
		added, err := r.Team.AddToCatalog(ctx, entry)
		if err != nil {
			return err
		}
		if !added && categoryID != nil {
			if err := r.Team.SetSkillCategory(ctx, entry); err != nil {
				return err
			}
		}
		catalog, err := r.Team.Catalog(ctx)
		if err != nil {
			return err
		}
		for _, c := range catalog {
			if strings.EqualFold(c.Name, name) {
				name = c.Name
			}
		}
		all, err := r.Team.Skills(ctx)
		if err != nil {
			return err
		}
		for _, id := range uniq(userIDs) {
			mine := all[id]
			if slices.ContainsFunc(mine, func(x string) bool { return strings.EqualFold(x, name) }) {
				continue
			}
			if len(mine) >= maxSkills {
				return apperr.Validation(map[string]string{"userIds": "too_many"})
			}
			if err := r.Team.SetSkills(ctx, id, append(slices.Clone(mine), name)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return s.List(ctx)
}

// RemoveSkill takes a name off the department's list. People who list it keep
// it, so it only disappears from the page once nobody has it.
func (s *Service) RemoveSkill(ctx context.Context, name string) error {
	err := s.st.Update(ctx, func(r store.Repos) error {
		return r.Team.RemoveFromCatalog(ctx, strings.TrimSpace(name))
	})
	if errors.Is(err, store.ErrNotFound) {
		return apperr.NotFound("skill")
	}
	return err
}

func categoryExists(ctx context.Context, r store.Repos, id *int64) error {
	if id == nil {
		return nil
	}
	cats, err := r.Team.Categories(ctx)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(cats, func(c store.SkillCategory) bool { return c.ID == *id }) {
		return apperr.Validation(map[string]string{"categoryId": "unknown"})
	}
	return nil
}

// SetSkillCategory moves a skill, named ignoring case, into categoryID (nil:
// uncategorised). The skill must be in the catalog or on someone's card; one
// only on cards joins the catalog under the first spelling found.
func (s *Service) SetSkillCategory(ctx context.Context, caller int64, raw string, categoryID *int64) (View, error) {
	name, err := cleanSkill(raw)
	if err != nil {
		return View{}, err
	}
	err = s.st.Update(ctx, func(r store.Repos) error {
		if err := categoryExists(ctx, r, categoryID); err != nil {
			return err
		}
		known, err := knownSpelling(ctx, r, name)
		if err != nil {
			return err
		}
		if known == "" {
			return apperr.NotFound("skill")
		}
		return r.Team.SetSkillCategory(ctx, store.CatalogSkill{Name: known, CategoryID: categoryID, CreatedBy: caller, CreatedAt: s.now()})
	})
	if err != nil {
		return View{}, err
	}
	return s.List(ctx)
}

// knownSpelling finds name (ignoring case) in the catalog, then on people's
// cards (lowest user id first, so the answer does not depend on map order).
// "" if nobody uses it.
func knownSpelling(ctx context.Context, r store.Repos, name string) (string, error) {
	catalog, err := r.Team.Catalog(ctx)
	if err != nil {
		return "", err
	}
	for _, c := range catalog {
		if strings.EqualFold(c.Name, name) {
			return c.Name, nil
		}
	}
	all, err := r.Team.Skills(ctx)
	if err != nil {
		return "", err
	}
	ids := make([]int64, 0, len(all))
	for id := range all {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		for _, sk := range all[id] {
			if strings.EqualFold(sk, name) {
				return sk, nil
			}
		}
	}
	return "", nil
}

// CreateCategory adds a skill category. Anyone signed in may add, as with
// skills. Names follow the skill rules and are unique ignoring case.
func (s *Service) CreateCategory(ctx context.Context, caller int64, raw string) (View, error) {
	name, err := cleanSkill(raw)
	if err != nil {
		return View{}, err
	}
	err = s.st.Update(ctx, func(r store.Repos) error {
		cats, err := r.Team.Categories(ctx)
		if err != nil {
			return err
		}
		if len(cats) >= maxCategories {
			return apperr.Validation(map[string]string{"name": "too_many"})
		}
		_, err = r.Team.CreateCategory(ctx, store.SkillCategory{Name: name, CreatedBy: caller, CreatedAt: s.now()})
		return err
	})
	if errors.Is(err, store.ErrDuplicate) {
		return View{}, apperr.Validation(map[string]string{"name": "exists"})
	}
	if err != nil {
		return View{}, err
	}
	return s.List(ctx)
}

// RenameCategory renames category id; changing only the case is allowed.
func (s *Service) RenameCategory(ctx context.Context, id int64, raw string) (View, error) {
	name, err := cleanSkill(raw)
	if err != nil {
		return View{}, err
	}
	err = s.st.Update(ctx, func(r store.Repos) error { return r.Team.RenameCategory(ctx, id, name) })
	switch {
	case errors.Is(err, store.ErrDuplicate):
		return View{}, apperr.Validation(map[string]string{"name": "exists"})
	case errors.Is(err, store.ErrNotFound):
		return View{}, apperr.NotFound("category")
	case err != nil:
		return View{}, err
	}
	return s.List(ctx)
}

// DeleteCategory removes category id. Its skills stay, uncategorised.
func (s *Service) DeleteCategory(ctx context.Context, id int64) (View, error) {
	err := s.st.Update(ctx, func(r store.Repos) error { return r.Team.DeleteCategory(ctx, id) })
	if errors.Is(err, store.ErrNotFound) {
		return View{}, apperr.NotFound("category")
	}
	if err != nil {
		return View{}, err
	}
	return s.List(ctx)
}

func uniq(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.Sort(out)
	return slices.Compact(out)
}

// cleanSkill applies the tag rules to one name, which is required.
func cleanSkill(raw string) (string, error) {
	s := strings.Join(strings.Fields(raw), " ")
	switch {
	case s == "":
		return "", apperr.Validation(map[string]string{"name": "required"})
	case utf8.RuneCountInString(s) > maxSkill:
		return "", apperr.Validation(map[string]string{"name": "too_long"})
	}
	return s, nil
}
