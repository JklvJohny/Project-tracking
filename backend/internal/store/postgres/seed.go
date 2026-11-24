package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"tracking-service/internal/store"
)

// SeedUserRole grants a system role without a service call, for the local
// seed and tests. Granting roles has no API: in production a DBA writes
// user_roles.
func (s *Store) SeedUserRole(ur store.UserRole) error {
	_, err := s.pool.Exec(context.Background(), `INSERT INTO user_roles (user_id, role, granted_at, granted_by)
		VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role,
		granted_at = EXCLUDED.granted_at, granted_by = EXCLUDED.granted_by`, ur.UserID, ur.Role, ur.GrantedAt, ur.GrantedBy)
	return err
}

// SeedSkills sets a person's skills directly (local seed data only).
func (s *Store) SeedSkills(userID int64, skills ...string) error {
	return s.Update(context.Background(), func(r store.Repos) error { return r.Team.SetSkills(context.Background(), userID, skills) })
}

// Empty reports whether no project exists yet, so the local seed runs once.
func (s *Store) Empty(ctx context.Context) (bool, error) {
	var any bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM projects)`).Scan(&any)
	return !any, err
}

// Activity returns the whole activity log in the order written, for tests.
func (s *Store) Activity() []store.ActivityEvent {
	rows, _ := s.pool.Query(context.Background(), `SELECT id, project_id, card_id, actor_id, type, payload, created_at
		FROM activity_events ORDER BY id`)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.ActivityEvent, error) {
		var e store.ActivityEvent
		var payload []byte
		err := row.Scan(&e.ID, &e.ProjectID, &e.CardID, &e.ActorID, &e.Type, &payload, &e.CreatedAt)
		e.Payload = json.RawMessage(payload)
		return e, err
	})
	if err != nil {
		panic(err)
	}
	return out
}
