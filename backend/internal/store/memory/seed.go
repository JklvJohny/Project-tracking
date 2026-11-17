package memory

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"time"

	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/rank"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
)

// Dev people (stub users): 1 admin, 2 manager, 3-8 regular.
// Prototype -> stub mapping: Anan=2, Mali=3, Kai=4, Ploy=5, Sam=7, Nina=8.
// User 6 is a viewer in project 1 so every project role is exercised.
const (
	uAdmin  = 1
	uPM     = 2
	uMali   = 3
	uKai    = 4
	uPloy   = 5
	uViewer = 6
	uSam    = 7
	uNina   = 8
)

// seedToday is the prototype's "today"; dates are fixed so the data is stable.
var seedToday = time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC)

func day(n int) *string {
	s := seedToday.AddDate(0, 0, n).Format("2006-01-02")
	return &s
}

type seedCard struct {
	title, desc, prio string
	labels            []string
	start, due        *string
	assignees         []int64
	checklist         []seedItem
	comments          []seedComment
}

type seedItem struct {
	text string
	done bool
}

type seedComment struct {
	author int64
	body   string
}

// items builds a checklist from (text, done) pairs.
func items(pairs ...any) []seedItem {
	out := make([]seedItem, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, seedItem{text: pairs[i].(string), done: pairs[i+1].(bool)})
	}
	return out
}

// Seed fills s with the prototype's two projects (and, when large, a load-test
// project). It goes through the services so the data obeys every rule
// (positions, completed_at, activity). Call it once, on an empty store.
func Seed(s *Store, up users.Provider, large bool) error {
	ctx := context.Background()
	ev := events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil)))
	projects := project.New(s, up, ev, s.now)
	boards := board.New(s, ev, s.now)
	cards := card.New(s, up, ev, s.now)

	at := s.now()
	s.SeedUserRole(store.UserRole{UserID: uAdmin, Role: "admin", GrantedAt: at, GrantedBy: uAdmin})
	s.SeedUserRole(store.UserRole{UserID: uPM, Role: "manager", GrantedAt: at, GrantedBy: uAdmin})

	// Project 1: Website Redesign. The service's default lists (To Do,
	// In Progress, Review, Done) are renamed to the prototype's four.
	p1, err := projects.Create(ctx, uPM, project.CreateProjectInput{
		Name: "Website Redesign", Description: "Refresh marketing site, new design system and CMS migration.",
		StartDate: day(-30), EndDate: day(45),
	})
	if err != nil {
		return fmt.Errorf("seed project 1: %w", err)
	}
	if err := addMembers(ctx, projects, p1.ID, []member{
		{uMali, "member"}, {uKai, "member"}, {uPloy, "member"}, {uViewer, "viewer"}, {uSam, "member"},
	}); err != nil {
		return err
	}
	lists, err := renameLists(ctx, boards, uPM, p1.ID)
	if err != nil {
		return err
	}
	lab := map[string]int64{}
	for _, l := range []struct{ name, color string }{
		{"Frontend", "blue"}, {"Backend", "purple"}, {"Design", "gray"},
		{"Bug", "red"}, {"Research", "yellow"}, {"Docs", "green"},
	} {
		v, err := projects.CreateLabel(ctx, uPM, p1.ID, project.LabelInput{Name: l.name, Color: l.color})
		if err != nil {
			return fmt.Errorf("seed label: %w", err)
		}
		lab[l.name] = v.ID
	}
	sd := &seeder{ctx: ctx, cards: cards, labels: lab}
	backlog, todo, doing, done := lists[0], lists[1], lists[2], lists[3]
	for _, c := range []struct {
		list int64
		c    seedCard
	}{
		{backlog, seedCard{title: "Audit current analytics events", prio: "low", labels: []string{"Research"}, assignees: []int64{uKai},
			desc: "List every tracked event on the current site and mark which ones we keep."}},
		{backlog, seedCard{title: "Dark mode tokens for marketing pages", prio: "medium", labels: []string{"Design", "Frontend"},
			start: day(12), due: day(20), assignees: []int64{uPloy}}},
		{backlog, seedCard{title: "Evaluate headless CMS options", prio: "low", labels: []string{"Research", "Backend"},
			start: day(8), due: day(30), assignees: []int64{uMali, uSam},
			checklist: items("Shortlist 3 vendors", true, "Pricing comparison", false, "Spike: content model", false, "Write recommendation", false)}},
		{todo, seedCard{title: "Build pricing page layout", prio: "high", labels: []string{"Frontend"}, start: day(-1), due: day(3),
			assignees: []int64{uPM, uPloy},
			desc:      "## Scope\n- Three plan tiers with **monthly / yearly** toggle\n- FAQ accordion\n- Comparison table on desktop only\n\nDesigns: [Figma file](https://example.com/figma)",
			checklist: items("Plan cards", false, "Billing toggle", false, "FAQ section", false),
			comments: []seedComment{
				{uPloy, "Final copy is in the doc, @[2] can you check the yearly discount?"},
				{uPM, "Looks good, starting today."}}}},
		{todo, seedCard{title: "Write API docs for /projects endpoints", prio: "medium", labels: []string{"Docs", "Backend"},
			start: day(1), due: day(6), assignees: []int64{uMali}}},
		{todo, seedCard{title: "Fix broken footer links on mobile", prio: "urgent", labels: []string{"Bug", "Frontend"},
			start: day(-6), due: day(-2), assignees: []int64{uSam},
			comments: []seedComment{{uKai, "Repro on iOS Safari only."}}}},
		{doing, seedCard{title: "Homepage hero redesign", prio: "high", labels: []string{"Design", "Frontend"}, start: day(-7), due: day(-1),
			assignees: []int64{uPloy, uPM},
			desc:      "New hero with product screenshot and a single primary CTA.\n\n- [x] Moodboard\n- [ ] Final visual",
			checklist: items("Moodboard", true, "Wireframe", true, "Visual design", true, "Responsive variants", false, "Handoff", false),
			comments: []seedComment{
				{uMali, "Love direction B."},
				{uPloy, "@[3] thanks! Iterating on mobile now."},
				{uPM, "Need this before the review on Friday."},
				{uPloy, "On it."}}}},
		{doing, seedCard{title: "Set up image CDN", prio: "medium", labels: []string{"Backend"}, start: day(-3), due: day(2), assignees: []int64{uMali}}},
		{doing, seedCard{title: "Accessibility pass on navigation", prio: "high", labels: []string{"Frontend"}, start: day(-4), due: day(5),
			assignees: []int64{uKai},
			checklist: items("Skip link", true, "Focus order", true, "Menu aria-expanded", false, "Contrast check", false, "Screen reader test", false, "Reduced motion", false)}},
		{doing, seedCard{title: "Form validation errors not announced", prio: "urgent", labels: []string{"Bug"}, start: day(-2), due: day(0),
			assignees: []int64{uPM}}},
		{done, seedCard{title: "Kickoff workshop notes", prio: "low", labels: []string{"Docs"}, start: day(-15), due: day(-12),
			assignees: []int64{uPM, uMali, uKai, uPloy},
			checklist: items("Agenda", true, "Notes", true, "Share with team", true)}},
		{done, seedCard{title: "Choose component library", prio: "medium", labels: []string{"Research", "Frontend"}, start: day(-13), due: day(-8),
			assignees: []int64{uPM, uKai},
			checklist: items("Compare options", true, "Decision record", true),
			comments:  []seedComment{{uKai, "Going with shadcn/ui."}}}},
	} {
		if err := sd.add(uPM, c.list, c.c); err != nil {
			return err
		}
	}

	// Project 2: Mobile App v2, on hold, empty board.
	p2, err := projects.Create(ctx, uPM, project.CreateProjectInput{
		Name: "Mobile App v2", Description: "Offline mode, push notifications and new onboarding.",
		StartDate: day(-10), EndDate: day(90),
	})
	if err != nil {
		return fmt.Errorf("seed project 2: %w", err)
	}
	if err := addMembers(ctx, projects, p2.ID, []member{{uPloy, "pm"}, {uSam, "member"}, {uNina, "viewer"}}); err != nil {
		return err
	}
	if _, err := renameLists(ctx, boards, uPM, p2.ID); err != nil {
		return err
	}
	hold := "on_hold"
	if _, err := projects.Update(ctx, uPM, p2.ID, project.UpdateProjectInput{Status: &hold}); err != nil {
		return fmt.Errorf("seed project 2 status: %w", err)
	}

	if large {
		return seedLarge(ctx, s, projects, boards)
	}
	return nil
}

type member struct {
	id   int64
	role string
}

func addMembers(ctx context.Context, projects *project.Service, projectID int64, ms []member) error {
	for _, m := range ms {
		if _, err := projects.AddMember(ctx, uPM, projectID, m.id, m.role); err != nil {
			return fmt.Errorf("seed member %d: %w", m.id, err)
		}
	}
	return nil
}

// renameLists gives the default lists (To Do, In Progress, Review, Done) the
// prototype's names and returns their ids in order.
func renameLists(ctx context.Context, boards *board.Service, uid, projectID int64) ([]int64, error) {
	names := []string{"Backlog", "To Do", "In Progress", "Done"}
	v, _, err := boards.Board(ctx, uid, projectID)
	if err != nil {
		return nil, fmt.Errorf("seed board: %w", err)
	}
	ids := make([]int64, len(v.Lists))
	for i, l := range v.Lists {
		ids[i] = l.ID
		if i < len(names) && l.Name != names[i] {
			n := names[i]
			if _, err := boards.UpdateList(ctx, uid, l.ID, board.UpdateListInput{Name: &n}); err != nil {
				return nil, fmt.Errorf("seed rename list: %w", err)
			}
		}
	}
	return ids, nil
}

type seeder struct {
	ctx    context.Context
	cards  *card.Service
	labels map[string]int64
}

func (sd *seeder) add(uid, listID int64, c seedCard) error {
	wrap := func(err error) error { return fmt.Errorf("seed card %q: %w", c.title, err) }
	d, err := sd.cards.Create(sd.ctx, uid, listID, card.CreateCardInput{Title: c.title})
	if err != nil {
		return wrap(err)
	}
	in := card.UpdateCardInput{Priority: &c.prio, DescriptionMD: &c.desc}
	if c.start != nil {
		in.StartDate = card.SetDate(c.start)
	}
	if c.due != nil {
		in.DueDate = card.SetDate(c.due)
	}
	if _, err := sd.cards.Update(sd.ctx, uid, d.ID, in); err != nil {
		return wrap(err)
	}
	for _, a := range c.assignees {
		if _, err := sd.cards.Assign(sd.ctx, uid, d.ID, a); err != nil {
			return wrap(err)
		}
	}
	for _, l := range c.labels {
		if _, err := sd.cards.AddLabel(sd.ctx, uid, d.ID, sd.labels[l]); err != nil {
			return wrap(err)
		}
	}
	for _, it := range c.checklist {
		v, err := sd.cards.AddItem(sd.ctx, uid, d.ID, it.text)
		if err != nil {
			return wrap(err)
		}
		if it.done {
			t := true
			if _, err := sd.cards.UpdateItem(sd.ctx, uid, v.ID, card.ItemPatch{IsDone: &t}); err != nil {
				return wrap(err)
			}
		}
	}
	for _, cm := range c.comments {
		if _, err := sd.cards.AddComment(sd.ctx, cm.author, d.ID, cm.body); err != nil {
			return wrap(err)
		}
	}
	return nil
}

// seedLarge adds "Load Test": 8 lists, 2,000 cards. The cards are written
// straight to the repos inside one Update (2,000 service calls would each
// deep-copy the whole store); positions still come from rank.Spread, so the
// board loads and drags work as on any other project.
func seedLarge(ctx context.Context, s *Store, projects *project.Service, boards *board.Service) error {
	p, err := projects.Create(ctx, uPM, project.CreateProjectInput{Name: "Load Test", Description: "2,000 cards for performance checks."})
	if err != nil {
		return fmt.Errorf("seed load test: %w", err)
	}
	for i := 5; i <= 8; i++ {
		if _, err := boards.CreateList(ctx, uPM, p.ID, fmt.Sprintf("List %d", i)); err != nil {
			return fmt.Errorf("seed load test list: %w", err)
		}
	}
	v, _, err := boards.Board(ctx, uPM, p.ID)
	if err != nil {
		return err
	}
	const perList = 250
	pos := rank.Spread(perList)
	return s.Update(ctx, func(r store.Repos) error {
		now := s.now()
		for _, l := range v.Lists {
			for i := 0; i < perList; i++ {
				c := store.Card{
					ListID: l.ID, Title: fmt.Sprintf("Load card %d-%d", l.ID, i+1), Priority: int16(i % 4),
					Position: pos[i], CreatedBy: uPM, CreatedAt: now, UpdatedAt: now,
				}
				if l.IsDone {
					c.CompletedAt = &now
				}
				if _, err := r.Cards.Create(ctx, c); err != nil {
					return err
				}
			}
		}
		b, err := r.Boards.ByProject(ctx, p.ID)
		if err != nil {
			return err
		}
		return r.Boards.Touch(ctx, b.ID, now)
	})
}
