package card_test

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"tracking-service/internal/card"
	"tracking-service/internal/clock"
	"tracking-service/internal/users"
)

type published struct {
	topic   string
	payload any
}

type recorder struct{ got []published }

func (r *recorder) Publish(_ context.Context, topic string, payload any) error {
	r.got = append(r.got, published{topic, payload})
	return nil
}

// withRecorder swaps in a card service that records published events.
func (e env) withRecorder() (env, *recorder) {
	rec := &recorder{}
	now := clock.Clock(func() time.Time { return t0.Add(time.Duration(*e.tick) * time.Minute) })
	e.svc = card.New(e.st, users.NewStub(), rec, now)
	return e, rec
}

func mention(n int64) string { return "@[" + id(n) + "]" }

func TestParseMentions(t *testing.T) {
	got := card.ParseMentions("hi @[3] and @[3] @[x] @[12]")
	if !reflect.DeepEqual(got, []int64{3, 12}) {
		t.Fatalf("got %v", got)
	}
}

func TestAddComment_OutsiderNotFound(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	if _, err := e.svc.AddComment(e.ctx, outside, c.ID, "hi"); code(err) != "not_found" {
		t.Fatalf("outside err = %v", err)
	}
}

func TestAddComment_NonMemberMentionIgnored(t *testing.T) {
	e, rec := newEnv(t).withRecorder()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	body := "a " + mention(member2) + " " + mention(admin) + " " + mention(outside) + " " + mention(99)
	cm, err := e.svc.AddComment(e.ctx, member, c.ID, body)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cm.MentionIDs, []int64{member2}) {
		t.Fatalf("mentionIds = %v", cm.MentionIDs)
	}
	if len(rec.got) != 1 || rec.got[0].topic != "tracking.comment.mentioned" {
		t.Fatalf("published = %+v", rec.got)
	}
	// a comment with no member mention publishes nothing
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, "x "+mention(outside)); err != nil {
		t.Fatal(err)
	}
	if len(rec.got) != 1 {
		t.Fatalf("published = %+v", rec.got)
	}
}

func TestEditComment_NotAuthorForbidden(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	cm, err := e.svc.AddComment(e.ctx, member, c.ID, "mine")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{manager, admin, member2} {
		if _, err := e.svc.EditComment(e.ctx, u, cm.ID, "x"); code(err) != "forbidden" {
			t.Fatalf("user %d err = %v", u, err)
		}
	}
	if _, err := e.svc.EditComment(e.ctx, outside, cm.ID, "x"); code(err) != "not_found" {
		t.Fatalf("outside err = %v", err)
	}
	got, err := e.svc.EditComment(e.ctx, member, cm.ID, "changed")
	if err != nil || got.BodyMD != "changed" || got.EditedAt == nil {
		t.Fatalf("edit: %v %+v", err, got)
	}
}

func TestDeleteComment_PMCanDeleteOthers_MemberCannot(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	mine, _ := e.svc.AddComment(e.ctx, manager, c.ID, "pm says")
	theirs, _ := e.svc.AddComment(e.ctx, member, c.ID, "member says")
	if err := e.svc.DeleteComment(e.ctx, member, mine.ID); code(err) != "forbidden" {
		t.Fatalf("member deleting pm's: %v", err)
	}
	if err := e.svc.DeleteComment(e.ctx, manager, theirs.ID); err != nil {
		t.Fatalf("pm deleting member's: %v", err)
	}
	if err := e.svc.DeleteComment(e.ctx, member, theirs.ID); code(err) != "not_found" {
		t.Fatalf("deleted again: %v", err)
	}
	if _, err := e.svc.EditComment(e.ctx, member, theirs.ID, "x"); code(err) != "not_found" {
		t.Fatalf("edit deleted: %v", err)
	}
	if err := e.svc.DeleteComment(e.ctx, member, mine.ID+100); code(err) != "not_found" {
		t.Fatalf("missing: %v", err)
	}
	list, err := e.svc.Comments(e.ctx, member, c.ID)
	if err != nil || len(list) != 1 || list[0].ID != mine.ID {
		t.Fatalf("list = %v %+v", err, list)
	}
	if e.checklistEvents("comment.deleted") != 1 || e.checklistEvents("comment.added") != 2 {
		t.Fatal("events wrong")
	}
}

func TestEdit_PublishesOnlyNewMentions(t *testing.T) {
	e, rec := newEnv(t).withRecorder()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	cm, err := e.svc.AddComment(e.ctx, member, c.ID, mention(member2))
	if err != nil {
		t.Fatal(err)
	}
	if len(rec.got) != 1 {
		t.Fatalf("add published %d", len(rec.got))
	}
	got, err := e.svc.EditComment(e.ctx, member, cm.ID, mention(member2)+" "+mention(manager))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.MentionIDs, []int64{member2, manager}) {
		t.Fatalf("mentionIds = %v", got.MentionIDs)
	}
	if len(rec.got) != 2 {
		t.Fatalf("published = %+v", rec.got)
	}
	p := rec.got[1].payload.(card.CommentMentioned)
	if !reflect.DeepEqual(p.UserIDs, []int64{manager}) || p.CommentID != cm.ID || p.CardID != c.ID || p.ProjectID != e.pid {
		t.Fatalf("payload = %+v", p)
	}
	// re-saving with the same mentions, or dropping one, publishes nothing
	if _, err := e.svc.EditComment(e.ctx, member, cm.ID, mention(manager)); err != nil {
		t.Fatal(err)
	}
	if len(rec.got) != 2 {
		t.Fatalf("published = %+v", rec.got)
	}
	// a failed write publishes nothing
	if _, err := e.svc.EditComment(e.ctx, member, cm.ID, strings.Repeat("a", 5001)+mention(member2)); code(err) != "validation_failed" {
		t.Fatalf("err = %v", err)
	}
	if len(rec.got) != 2 {
		t.Fatalf("published = %+v", rec.got)
	}
}

func TestAddComment_ArchivedCardConflict(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	cm, _ := e.svc.AddComment(e.ctx, member, c.ID, "x")
	if _, err := e.svc.Archive(e.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, "y"); code(err) != "conflict" {
		t.Fatalf("add: %v", err)
	}
	if _, err := e.svc.EditComment(e.ctx, member, cm.ID, "y"); code(err) != "conflict" {
		t.Fatalf("edit: %v", err)
	}
	if err := e.svc.DeleteComment(e.ctx, member, cm.ID); code(err) != "conflict" {
		t.Fatalf("delete: %v", err)
	}
}

func TestAddComment_Validation(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, "  "); code(err) != "validation_failed" || fieldsOf(err)["body"] == "" {
		t.Fatalf("empty: %v %v", err, fieldsOf(err))
	}
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, strings.Repeat("ก", 5001)); fieldsOf(err)["body"] != "too_long" {
		t.Fatalf("long: %v", err)
	}
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, strings.Repeat("ก", 5000)); err != nil {
		t.Fatalf("5000: %v", err)
	}
}

func TestCommentCount_InBoardSnapshot(t *testing.T) {
	e := newEnv(t)
	c := e.mk(t, e.lists(t)[0].ID, "c")
	count := func() int {
		v, _, err := e.board.Board(e.ctx, member, e.pid)
		if err != nil {
			t.Fatal(err)
		}
		for _, cs := range v.Cards {
			if cs.ID == c.ID {
				return cs.CommentCount
			}
		}
		t.Fatal("card not on board")
		return 0
	}
	a, _ := e.svc.AddComment(e.ctx, member, c.ID, "a")
	if _, err := e.svc.AddComment(e.ctx, member, c.ID, "b"); err != nil {
		t.Fatal(err)
	}
	before := e.boardUpdatedAt(t)
	if count() != 2 {
		t.Fatalf("count = %d", count())
	}
	*e.tick = 5
	if err := e.svc.DeleteComment(e.ctx, member, a.ID); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Fatalf("after delete = %d", count())
	}
	if !e.boardUpdatedAt(t).After(before) {
		t.Fatal("board not bumped")
	}
	if cd, _ := e.svc.Get(e.ctx, member, c.ID); !cd.UpdatedAt.Equal(t0.Add(5 * time.Minute)) {
		t.Fatalf("card not touched: %v", cd.UpdatedAt)
	}
}

func TestCommentRoute_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	cm, err := e.svc.AddComment(e.ctx, member, c.ID, "hi")
	if err != nil {
		t.Fatal(err)
	}
	for _, rc := range []struct{ method, path, body string }{
		{"GET", "/cards/" + id(c.ID) + "/comments", ""},
		{"POST", "/cards/" + id(c.ID) + "/comments", `{"body":"x"}`},
		{"PATCH", "/comments/" + id(cm.ID), `{"body":"x"}`},
		{"DELETE", "/comments/" + id(cm.ID), ""},
	} {
		rec, body := do(h, outside, rc.method, rc.path, rc.body)
		if rec.Code != 404 || body["code"] != "not_found" || body["data"] != nil {
			t.Errorf("%s %s = %d %s", rc.method, rc.path, rec.Code, rec.Body)
		}
	}
}

func TestCommentRoutes_HappyPath(t *testing.T) {
	e := newEnv(t)
	h := e.handler()
	c := e.mk(t, e.lists(t)[0].ID, "c")
	rec, body := do(h, member, "POST", "/cards/"+id(c.ID)+"/comments", `{"body":"hello"}`)
	if rec.Code != 201 {
		t.Fatalf("add = %d %s", rec.Code, rec.Body)
	}
	data := body["data"].(map[string]any)
	for _, k := range []string{"id", "cardId", "authorId", "bodyMd", "createdAt", "editedAt", "mentionIds"} {
		if _, ok := data[k]; !ok {
			t.Errorf("missing %q in %v", k, data)
		}
	}
	cid := id(int64(data["id"].(float64)))
	if rec, _ = do(h, member, "PATCH", "/comments/"+cid, `{"body":"edited"}`); rec.Code != 200 {
		t.Fatalf("edit = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, member, "GET", "/cards/"+id(c.ID)+"/comments", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), "edited") {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	if rec, _ = do(h, member, "DELETE", "/comments/"+cid, ""); rec.Code != 200 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
}
