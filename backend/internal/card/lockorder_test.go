package card_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/events"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
)

// recStore records the lock and write calls of each Update so a test can
// assert the global lock order: the board row is locked first.
type recStore struct {
	store.Store
	log *[]string
}

func (s recStore) Update(ctx context.Context, fn func(store.Repos) error) error {
	return s.Store.Update(ctx, func(r store.Repos) error {
		note := func(n string) { *s.log = append(*s.log, n) }
		r.Boards = recBoards{r.Boards, note}
		r.Lists = recLists{r.Lists, note}
		r.Cards = recCards{r.Cards, note}
		r.Checklist = recChecklist{r.Checklist, note}
		r.Labels = recLabels{r.Labels, note}
		r.Members = recMembers{r.Members, note}
		r.Comments = recComments{r.Comments, note}
		r.Projects = recProjects{r.Projects, note}
		return fn(r)
	})
}

type recBoards struct {
	store.BoardRepo
	n func(string)
}

func (r recBoards) Lock(ctx context.Context, id int64) error {
	r.n("Boards.Lock")
	return r.BoardRepo.Lock(ctx, id)
}

func (r recBoards) Touch(ctx context.Context, id int64, at time.Time) error {
	r.n("Boards.Touch")
	return r.BoardRepo.Touch(ctx, id, at)
}

type recLists struct {
	store.ListRepo
	n func(string)
}

func (r recLists) Save(ctx context.Context, l store.List) error {
	r.n("Lists.Save")
	return r.ListRepo.Save(ctx, l)
}

func (r recLists) Create(ctx context.Context, l store.List) (store.List, error) {
	r.n("Lists.Create")
	return r.ListRepo.Create(ctx, l)
}

type recCards struct {
	store.CardRepo
	n func(string)
}

func (r recCards) LockList(ctx context.Context, id int64) error {
	r.n("Cards.LockList")
	return r.CardRepo.LockList(ctx, id)
}

func (r recCards) Save(ctx context.Context, c store.Card) error {
	r.n("Cards.Save")
	return r.CardRepo.Save(ctx, c)
}

func (r recCards) Create(ctx context.Context, c store.Card) (store.Card, error) {
	r.n("Cards.Create")
	return r.CardRepo.Create(ctx, c)
}

func (r recCards) Touch(ctx context.Context, id int64, at time.Time) error {
	r.n("Cards.Touch")
	return r.CardRepo.Touch(ctx, id, at)
}

func (r recCards) AddAssignee(ctx context.Context, c, u int64, at time.Time) (bool, error) {
	r.n("Cards.AddAssignee")
	return r.CardRepo.AddAssignee(ctx, c, u, at)
}

func (r recCards) AddLabel(ctx context.Context, c, l int64) (bool, error) {
	r.n("Cards.AddLabel")
	return r.CardRepo.AddLabel(ctx, c, l)
}

type recChecklist struct {
	store.ChecklistRepo
	n func(string)
}

func (r recChecklist) LockCard(ctx context.Context, id int64) error {
	r.n("Checklist.LockCard")
	return r.ChecklistRepo.LockCard(ctx, id)
}

func (r recChecklist) Create(ctx context.Context, it store.ChecklistItem) (store.ChecklistItem, error) {
	r.n("Checklist.Create")
	return r.ChecklistRepo.Create(ctx, it)
}

type recLabels struct {
	store.LabelRepo
	n func(string)
}

func (r recLabels) Create(ctx context.Context, l store.Label) (store.Label, error) {
	r.n("Labels.Create")
	return r.LabelRepo.Create(ctx, l)
}

type recMembers struct {
	store.MemberRepo
	n func(string)
}

func (r recMembers) Put(ctx context.Context, m store.Member) error {
	r.n("Members.Put")
	return r.MemberRepo.Put(ctx, m)
}

func (r recMembers) Delete(ctx context.Context, p, u int64) error {
	r.n("Members.Delete")
	return r.MemberRepo.Delete(ctx, p, u)
}

type recComments struct {
	store.CommentRepo
	n func(string)
}

func (r recComments) Create(ctx context.Context, c store.Comment) (store.Comment, error) {
	r.n("Comments.Create")
	return r.CommentRepo.Create(ctx, c)
}

func (r recComments) Save(ctx context.Context, c store.Comment) error {
	r.n("Comments.Save")
	return r.CommentRepo.Save(ctx, c)
}

func (r recChecklist) Save(ctx context.Context, it store.ChecklistItem) error {
	r.n("Checklist.Save")
	return r.ChecklistRepo.Save(ctx, it)
}

func (r recChecklist) Delete(ctx context.Context, id int64) error {
	r.n("Checklist.Delete")
	return r.ChecklistRepo.Delete(ctx, id)
}

func (r recChecklist) SetPositions(ctx context.Context, ps []store.IDPos) error {
	r.n("Checklist.SetPositions")
	return r.ChecklistRepo.SetPositions(ctx, ps)
}

func (r recCards) SetPositions(ctx context.Context, ps []store.IDPos) error {
	r.n("Cards.SetPositions")
	return r.CardRepo.SetPositions(ctx, ps)
}

func (r recCards) RemoveAssignee(ctx context.Context, c, u int64) (bool, error) {
	r.n("Cards.RemoveAssignee")
	return r.CardRepo.RemoveAssignee(ctx, c, u)
}

func (r recCards) UnassignInProject(ctx context.Context, p, u int64) ([]int64, error) {
	r.n("Cards.UnassignInProject")
	return r.CardRepo.UnassignInProject(ctx, p, u)
}

func (r recLists) SetPositions(ctx context.Context, ps []store.IDPos) error {
	r.n("Lists.SetPositions")
	return r.ListRepo.SetPositions(ctx, ps)
}

type recProjects struct {
	store.ProjectRepo
	n func(string)
}

func (r recProjects) Save(ctx context.Context, p store.Project) error {
	r.n("Projects.Save")
	return r.ProjectRepo.Save(ctx, p)
}

// Every write that changes board-visible data takes the board row lock before
// any other lock or write; otherwise two writers can take the board and a list
// in opposite orders and deadlock in PostgreSQL.
func TestWrites_TakeBoardLockFirst(t *testing.T) {
	mem := memory.New(time.Now)
	if err := memory.Seed(mem, users.NewStub(), false); err != nil {
		t.Fatal(err)
	}
	var log []string
	st := recStore{mem, &log}
	ev := events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil)))
	proj := project.New(st, users.NewStub(), ev, time.Now)
	brd := board.New(st, ev, time.Now)
	crd := card.New(st, users.NewStub(), ev, time.Now)
	ctx := context.Background()
	const pm = 2 // pm of both seed projects; lists 1-4 and cards 1-12 are project 1

	str := func(s string) *string { return &s }
	yes := true
	// Ids made by earlier steps, for the steps that edit or delete them.
	var itemID, commentID, labelID int64
	ops := []struct {
		name string
		do   func() error
	}{
		{"CreateList", func() error { _, err := brd.CreateList(ctx, pm, 1, "X"); return err }},
		{"UpdateList", func() error { _, err := brd.UpdateList(ctx, pm, 1, board.UpdateListInput{Name: str("Y")}); return err }},
		{"MoveList", func() error { _, err := brd.MoveList(ctx, pm, 1, board.MoveInput{}); return err }},
		{"ArchiveList", func() error { _, err := brd.ArchiveList(ctx, pm, 2); return err }},
		{"RestoreList", func() error { _, err := brd.RestoreList(ctx, pm, 2); return err }},
		{"CreateCard", func() error { _, err := crd.Create(ctx, pm, 1, card.CreateCardInput{Title: "N"}); return err }},
		{"UpdateCard", func() error { _, err := crd.Update(ctx, pm, 1, card.UpdateCardInput{Title: str("T")}); return err }},
		{"MoveCard", func() error { _, err := crd.Move(ctx, pm, 1, card.MoveCardInput{ToListID: 3}); return err }},
		{"ArchiveCard", func() error { _, err := crd.Archive(ctx, pm, 1); return err }},
		{"RestoreCard", func() error { _, err := crd.Restore(ctx, pm, 1); return err }},
		{"Assign", func() error { _, err := crd.Assign(ctx, pm, 2, 6); return err }},
		{"AddLabel", func() error { _, err := crd.AddLabel(ctx, pm, 2, 6); return err }},
		{"Unassign", func() error { _, err := crd.Unassign(ctx, pm, 2, 6); return err }},
		{"RemoveLabel", func() error { _, err := crd.RemoveLabel(ctx, pm, 2, 6); return err }},
		{"AddItem", func() error { it, err := crd.AddItem(ctx, pm, 2, "i"); itemID = it.ID; return err }},
		{"UpdateItem", func() error { _, err := crd.UpdateItem(ctx, pm, itemID, card.ItemPatch{IsDone: &yes}); return err }},
		{"MoveItem", func() error { _, err := crd.MoveItem(ctx, pm, itemID, board.MoveInput{}); return err }},
		{"DeleteItem", func() error { return crd.DeleteItem(ctx, pm, itemID) }},
		{"AddComment", func() error { c, err := crd.AddComment(ctx, pm, 2, "c"); commentID = c.ID; return err }},
		{"EditComment", func() error { _, err := crd.EditComment(ctx, pm, commentID, "edited"); return err }},
		{"DeleteComment", func() error { return crd.DeleteComment(ctx, pm, commentID) }},
		{"CreateLabel", func() error {
			l, err := proj.CreateLabel(ctx, pm, 1, project.LabelInput{Name: "Zed", Color: "red"})
			labelID = l.ID
			return err
		}},
		{"UpdateLabel", func() error {
			_, err := proj.UpdateLabel(ctx, pm, labelID, project.LabelPatch{Color: str("blue")})
			return err
		}},
		{"DeleteLabel", func() error { return proj.DeleteLabel(ctx, pm, labelID) }},
		{"AddMember", func() error { _, err := proj.AddMember(ctx, pm, 2, 3, "member"); return err }},
		{"SetRole", func() error { _, err := proj.SetRole(ctx, pm, 2, 3, "viewer"); return err }},
		{"RemoveMember", func() error { return proj.RemoveMember(ctx, pm, 2, 3) }},
		{"UpdateProject", func() error {
			_, err := proj.Update(ctx, pm, 1, project.UpdateProjectInput{Name: str("W")})
			return err
		}},
		{"ArchiveProject", func() error { _, err := proj.Archive(ctx, pm, 2); return err }},
		{"RestoreProject", func() error { _, err := proj.Restore(ctx, pm, 2); return err }},
	}
	for _, op := range ops {
		log = log[:0]
		if err := op.do(); err != nil {
			t.Fatalf("%s: %v", op.name, err)
		}
		if len(log) == 0 || log[0] != "Boards.Lock" {
			t.Errorf("%s: calls were %v, want Boards.Lock first", op.name, log)
		}
	}
}
