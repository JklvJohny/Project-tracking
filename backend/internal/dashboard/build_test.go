package dashboard_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"tracking-service/internal/dashboard"
	"tracking-service/internal/store"
)

const today store.Date = "2026-11-18"

func d(s string) *store.Date { v := store.Date(s); return &v }

var doneAt = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)

func row(id int64, start, due string, done bool, prio int16, assignees ...int64) store.DashboardRow {
	r := store.DashboardRow{CardID: id, ProjectID: 1, ProjectName: "Alpha", ListName: "To Do",
		Title: fmt.Sprintf("card %d", id), Priority: prio, AssigneeIDs: assignees}
	if start != "" {
		r.StartDate = d(start)
	}
	if due != "" {
		r.DueDate = d(due)
	}
	if done {
		r.CompletedAt = &doneAt
	}
	if r.AssigneeIDs == nil {
		r.AssigneeIDs = []int64{}
	}
	return r
}

func TestBuild_StatusBoundaries(t *testing.T) {
	rows := []store.DashboardRow{
		row(1, "", "2026-11-17", false, 1),           // overdue
		row(2, "", "2026-11-18", false, 1),           // due today: not overdue, not started
		row(3, "2026-11-18", "", false, 1),           // start today: in progress
		row(4, "2026-11-19", "", false, 1),           // starts tomorrow: not started
		row(5, "2026-11-01", "2026-11-10", true, 1),  // done wins over overdue
		row(6, "2026-11-01", "2026-11-17", false, 1), // overdue wins over in progress
		row(7, "", "", false, 1),                     // not started
		row(8, "2026-11-01", "2026-11-18", false, 1), // in progress, due today
		row(9, "", "2026-11-25", false, 1),           // today+7: due soon
		row(10, "", "2026-11-26", false, 1),          // today+8: not due soon
	}
	v := dashboard.Build(rows, nil, nil, today)
	want := dashboard.Totals{Total: 10, Done: 1, Open: 9, InProgress: 2, NotStarted: 5, Overdue: 2, DueSoon: 3, Unassigned: 9}
	if v.Totals != want {
		t.Fatalf("totals = %+v, want %+v", v.Totals, want)
	}
	if v.AsOf != "2026-11-18" {
		t.Errorf("asOf = %q", v.AsOf)
	}
}

func TestBuild_DueSoonIncludesTodayAndExcludesDoneAndOverdue(t *testing.T) {
	rows := []store.DashboardRow{
		row(1, "", "2026-11-18", false, 1),
		row(2, "", "2026-11-20", true, 1),
		row(3, "", "2026-11-17", false, 1),
	}
	if got := dashboard.Build(rows, nil, nil, today).Totals.DueSoon; got != 1 {
		t.Fatalf("dueSoon = %d, want 1", got)
	}
}

func TestBuild_UnassignedCountsOpenOnly(t *testing.T) {
	rows := []store.DashboardRow{
		row(1, "", "", false, 1),
		row(2, "", "", false, 1, 7),
		row(3, "", "", true, 1),
	}
	if got := dashboard.Build(rows, nil, nil, today).Totals.Unassigned; got != 1 {
		t.Fatalf("unassigned = %d, want 1", got)
	}
}

func TestBuild_ByProjectSortedByNameWithSplit(t *testing.T) {
	a := row(1, "", "", true, 1)
	b := row(2, "2026-11-01", "", false, 1)
	c := row(3, "", "2026-11-01", false, 1)
	e := row(4, "", "", false, 1)
	z := row(5, "", "", false, 1)
	z.ProjectID, z.ProjectName = 9, "Zeta"
	for _, r := range []*store.DashboardRow{&a, &b, &c, &e} {
		r.ProjectID, r.ProjectName = 2, "Beta"
	}
	v := dashboard.Build([]store.DashboardRow{z, a, b, c, e}, nil, nil, today)
	if len(v.ByProject) != 2 || v.ByProject[0].Name != "Beta" || v.ByProject[1].Name != "Zeta" {
		t.Fatalf("byProject = %+v", v.ByProject)
	}
	got := v.ByProject[0]
	if got.ID != 2 || got.Done != 1 || got.InProgress != 1 || got.Overdue != 1 || got.NotStarted != 1 || got.Total != 4 {
		t.Fatalf("beta = %+v", got)
	}
}

func TestBuild_WorkloadIncludesZeroTaskMembersAndOrders(t *testing.T) {
	members := []store.Member{
		{ProjectID: 1, UserID: 1}, {ProjectID: 1, UserID: 2}, {ProjectID: 1, UserID: 3},
		{ProjectID: 2, UserID: 2}, // same person in two projects counts once
		{ProjectID: 1, UserID: 4},
	}
	users := map[int64]store.CachedUser{
		1: {UserID: 1, DisplayName: "Zed", AvatarURL: "z.png"},
		2: {UserID: 2, DisplayName: "Amy"},
		3: {UserID: 3, DisplayName: "Bob"},
		4: {UserID: 4, DisplayName: "Cat"},
	}
	rows := []store.DashboardRow{
		row(1, "2026-11-01", "", false, 1, 3),
		row(2, "", "2026-11-01", false, 1, 3, 4),
		row(3, "", "", false, 1, 4),
		row(4, "", "", true, 1, 1),   // done: not workload
		row(5, "", "", false, 1, 99), // assignee outside the scope: ignored
	}
	v := dashboard.Build(rows, members, users, today)
	var names []string
	for _, w := range v.Workload {
		names = append(names, w.User.Name)
	}
	// Bob 2 open, Cat 2 open (tie: by name), then Amy 0, Zed 0.
	if fmt.Sprint(names) != "[Bob Cat Amy Zed]" {
		t.Fatalf("order = %v", names)
	}
	bob := v.Workload[0]
	if bob.InProgress != 1 || bob.Overdue != 1 || bob.NotStarted != 0 || bob.Open != 2 {
		t.Fatalf("bob = %+v", bob)
	}
	if v.Workload[3].User.AvatarURL != "z.png" || v.Workload[3].Open != 0 {
		t.Fatalf("zed = %+v", v.Workload[3])
	}
}

func TestBuild_ByPriorityAllFourAlwaysPresent(t *testing.T) {
	rows := []store.DashboardRow{
		row(1, "", "", false, 3), row(2, "", "", false, 3), row(3, "", "", false, 0),
		row(4, "", "", true, 2),
	}
	v := dashboard.Build(rows, nil, nil, today)
	if got := fmt.Sprint(v.ByPriority); got != "[{urgent 2} {high 0} {medium 0} {low 1}]" {
		t.Fatalf("byPriority = %s", got)
	}
	if empty := dashboard.Build(nil, nil, nil, today); len(empty.ByPriority) != 4 {
		t.Fatalf("empty byPriority = %v", empty.ByPriority)
	}
}

func TestBuild_DeadlinesFilterOrderAndDaysLeft(t *testing.T) {
	a1 := row(1, "", "2026-11-16", false, 1, 5) // 2d overdue
	a2 := row(2, "", "2026-11-18", false, 1)    // today
	a3 := row(3, "", "2026-12-02", false, 1)    // +14: in
	a4 := row(4, "", "2026-12-03", false, 1)    // +15: out
	a5 := row(5, "", "2026-11-16", true, 1)     // done: out
	a6 := row(6, "", "", false, 1)              // no due: out
	a7 := row(7, "", "2026-11-16", false, 1)    // same date as 1: by card id
	users := map[int64]store.CachedUser{5: {UserID: 5, DisplayName: "Eve", AvatarURL: "e.png"}}
	v := dashboard.Build([]store.DashboardRow{a7, a6, a5, a4, a3, a2, a1}, nil, users, today)
	var ids []int64
	for _, x := range v.Deadlines {
		ids = append(ids, x.CardID)
	}
	if fmt.Sprint(ids) != "[1 7 2 3]" {
		t.Fatalf("deadline ids = %v", ids)
	}
	if v.Deadlines[0].DaysLeft != -2 || v.Deadlines[2].DaysLeft != 0 || v.Deadlines[3].DaysLeft != 14 {
		t.Fatalf("daysLeft = %d %d %d", v.Deadlines[0].DaysLeft, v.Deadlines[2].DaysLeft, v.Deadlines[3].DaysLeft)
	}
	first := v.Deadlines[0]
	if first.ProjectName != "Alpha" || first.ListName != "To Do" || first.DueDate != "2026-11-16" ||
		len(first.Assignees) != 1 || first.Assignees[0].Name != "Eve" || first.Assignees[0].AvatarURL != "e.png" {
		t.Fatalf("first = %+v", first)
	}
	if v.Deadlines[1].Assignees == nil {
		t.Fatal("assignees must not be nil")
	}
}

func TestBuild_DeadlinesCappedAt20(t *testing.T) {
	var rows []store.DashboardRow
	for i := int64(1); i <= 25; i++ {
		rows = append(rows, row(i, "", "2026-11-20", false, 1))
	}
	v := dashboard.Build(rows, nil, nil, today)
	if len(v.Deadlines) != 20 || v.Deadlines[0].CardID != 1 || v.Deadlines[19].CardID != 20 {
		t.Fatalf("deadlines len=%d", len(v.Deadlines))
	}
}

func TestBuild_EmptyJSONHasNoNulls(t *testing.T) {
	b, err := json.Marshal(dashboard.Build(nil, nil, nil, today))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, k := range []string{"byProject", "workload", "byPriority", "deadlines"} {
		if _, ok := m[k].([]any); !ok {
			t.Errorf("%s = %v, want array", k, m[k])
		}
	}
}
