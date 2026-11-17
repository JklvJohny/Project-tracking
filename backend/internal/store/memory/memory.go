// Package memory is the in-memory store for local development and tests.
// Update works on a deep copy and swaps it in only on success, which gives
// the same all-or-nothing behaviour as a database transaction.
package memory

import (
	"context"
	"sync"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

type (
	memberKey    struct{ ProjectID, UserID int64 }
	assigneeKey  struct{ CardID, UserID int64 }
	cardLabelKey struct{ CardID, LabelID int64 }
	mentionKey   struct{ CommentID, UserID int64 }
)

// data holds every P1 entity (ERD) plus activity_events, so later tasks only
// add repo methods and never reshape clone.
type data struct {
	projects      map[int64]store.Project
	members       map[memberKey]store.Member
	boards        map[int64]store.Board
	lists         map[int64]store.List
	cards         map[int64]store.Card
	cardAssignees map[assigneeKey]store.CardAssignee
	cardLabels    map[cardLabelKey]store.CardLabel
	labels        map[int64]store.Label
	checklist     map[int64]store.ChecklistItem
	comments      map[int64]store.Comment
	mentions      map[mentionKey]store.CommentMention
	userRoles     map[int64]store.UserRole
	userCache     map[int64]store.CachedUser
	activity      []store.ActivityEvent

	// seq[table] is the last id issued for that table.
	seq map[string]int64
}

func newData() *data {
	return &data{
		projects:      map[int64]store.Project{},
		members:       map[memberKey]store.Member{},
		boards:        map[int64]store.Board{},
		lists:         map[int64]store.List{},
		cards:         map[int64]store.Card{},
		cardAssignees: map[assigneeKey]store.CardAssignee{},
		cardLabels:    map[cardLabelKey]store.CardLabel{},
		labels:        map[int64]store.Label{},
		checklist:     map[int64]store.ChecklistItem{},
		comments:      map[int64]store.Comment{},
		mentions:      map[mentionKey]store.CommentMention{},
		userRoles:     map[int64]store.UserRole{},
		userCache:     map[int64]store.CachedUser{},
		seq:           map[string]int64{},
	}
}

func (d *data) nextID(table string) int64 {
	d.seq[table]++
	return d.seq[table]
}

// Store implements store.Store.
type Store struct {
	mu  sync.RWMutex
	d   *data
	now clock.Clock
}

func New(now clock.Clock) *Store { return &Store{d: newData(), now: now} }

var _ store.Store = (*Store)(nil)

// stub is the placeholder for repos whose interface has no methods yet.
type stub struct{}

func (s *Store) repos(d *data) store.Repos {
	return store.Repos{
		Projects:  &projectRepo{d: d},
		Members:   &memberRepo{d: d},
		Boards:    &boardRepo{d: d},
		Lists:     &listRepo{d: d},
		Cards:     &cardRepo{d: d},
		Labels:    stub{},
		Checklist: stub{},
		Comments:  stub{},
		UserRoles: &userRolesRepo{d: d},
		Users:     &usersRepo{d: d, now: s.now},
		Activity:  &activityRepo{d: d, now: s.now},
	}
}

func (s *Store) View(_ context.Context, fn func(store.Repos) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(s.repos(s.d))
}

func (s *Store) Update(_ context.Context, fn func(store.Repos) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	work := s.d.clone()
	if err := fn(s.repos(work)); err != nil {
		return err
	}
	s.d = work
	return nil
}

// Activity returns a copy of the committed activity log, for tests.
func (s *Store) Activity() []store.ActivityEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneEvents(s.d.activity)
}

// SeedUserRole grants a system role without a service call, for seeds and tests.
func (s *Store) SeedUserRole(ur store.UserRole) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.d.userRoles[ur.UserID] = ur
}
