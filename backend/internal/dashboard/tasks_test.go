package dashboard_test

import (
	"testing"

	"tracking-service/internal/store"
)

// addAlphaCards adds to Alpha: a completed card, a card with no due date (shared with userB, checklist 1/2) and a
// card due later, all assigned to userA, plus one assigned only to userB.
func addAlphaCards(t *testing.T, f fixture) {
	t.Helper()
	err := f.st.Update(f.ctx, func(r store.Repos) error {
		rows, err := r.Dashboard.Rows(f.ctx, []int64{f.pAlpha})
		if err != nil {
			return err
		}
		c, err := r.Cards.Get(f.ctx, rows[0].CardID)
		if err != nil {
			return err
		}
		mk := func(title string, due *store.Date, done bool, who ...int64) (int64, error) {
			card := store.Card{ListID: c.ListID, Title: title, DueDate: due}
			if done {
				card.CompletedAt = &nearMidnightUTC
			}
			card, err := r.Cards.Create(f.ctx, card)
			if err != nil {
				return 0, err
			}
			for _, u := range who {
				if _, err := r.Cards.AddAssignee(f.ctx, card.ID, u, nearMidnightUTC); err != nil {
					return 0, err
				}
			}
			return card.ID, nil
		}
		later := store.Date("2026-11-25")
		if _, err := mk("Finished", &later, true, userA); err != nil {
			return err
		}
		id, err := mk("Someday", nil, false, userB, userA)
		if err != nil {
			return err
		}
		for _, done := range []bool{true, false} {
			if _, err := r.Checklist.Create(f.ctx, store.ChecklistItem{CardID: id, Text: "x", IsDone: done, Position: "a"}); err != nil {
				return err
			}
		}
		if _, err := mk("Next week", &later, false, userA); err != nil {
			return err
		}
		_, err = mk("Ben only", &later, false, userB)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestMyTasks_OpenAssignedCardsInVisibleProjects(t *testing.T) {
	f := newFixture(t)
	addAlphaCards(t, f)
	v, err := f.svc.MyTasks(f.ctx, userA)
	if err != nil {
		t.Fatal(err)
	}
	if v.AsOf != "2026-11-18" {
		t.Fatalf("asOf = %q", v.AsOf)
	}
	// Beta's card is assigned to Ann but she is not a Beta member; the archived project and the completed card
	// are out too. Order: due date ascending, no due date last.
	var titles []string
	for _, task := range v.Tasks {
		titles = append(titles, task.Title)
	}
	want := []string{"Alpha overdue", "Next week", "Someday"}
	if len(titles) != len(want) {
		t.Fatalf("titles = %v, want %v", titles, want)
	}
	for i := range want {
		if titles[i] != want[i] {
			t.Fatalf("titles = %v, want %v", titles, want)
		}
	}
	if d := v.Tasks[0].DaysLeft; d == nil || *d != -1 {
		t.Fatalf("overdue daysLeft = %v, want -1", d)
	}
	if d := v.Tasks[1].DaysLeft; d == nil || *d != 7 {
		t.Fatalf("next week daysLeft = %v, want 7", d)
	}
	s := v.Tasks[2]
	if s.DaysLeft != nil || s.DueDate != nil || s.ChecklistTotal != 2 || s.ChecklistDone != 1 {
		t.Fatalf("someday = %+v", s)
	}
	if len(s.Assignees) != 2 || s.Assignees[0].Name != "Ann" || s.Assignees[1].Name != "Ben" {
		t.Fatalf("assignees = %+v", s.Assignees)
	}
	if s.ProjectName != "Alpha" || s.ListName != "Doing" || s.Priority != "low" {
		t.Fatalf("someday = %+v", s)
	}
}

func TestMyTasks_NothingAssignedIsEmptyArray(t *testing.T) {
	f := newFixture(t)
	rec, body := getPath(f, outsider, "/me/tasks")
	if rec.Code != 200 {
		t.Fatalf("get = %d %s", rec.Code, rec.Body)
	}
	data := body["data"].(map[string]any)
	if tasks, ok := data["tasks"].([]any); !ok || len(tasks) != 0 {
		t.Fatalf("tasks = %v, want []", data["tasks"])
	}
}

func TestMyTasks_HandlerShape(t *testing.T) {
	f := newFixture(t)
	rec, body := getPath(f, userA, "/me/tasks")
	if rec.Code != 200 || body["success"] != true {
		t.Fatalf("get = %d %s", rec.Code, rec.Body)
	}
	task := body["data"].(map[string]any)["tasks"].([]any)[0].(map[string]any)
	for _, k := range []string{"cardId", "projectId", "projectName", "listName", "title", "priority", "startDate", "dueDate", "daysLeft", "checklistTotal", "checklistDone", "assignees"} {
		if _, ok := task[k]; !ok {
			t.Errorf("missing task.%q", k)
		}
	}
}
