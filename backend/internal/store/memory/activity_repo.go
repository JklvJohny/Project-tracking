package memory

import (
	"context"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

type activityRepo struct {
	d   *data
	now clock.Clock
}

func (r *activityRepo) Append(_ context.Context, e store.ActivityEvent) error {
	e.ID = r.d.nextID("activity_events")
	if e.CreatedAt.IsZero() {
		e.CreatedAt = r.now()
	}
	r.d.activity = append(r.d.activity, e)
	return nil
}
