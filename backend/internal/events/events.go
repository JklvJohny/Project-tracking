// Package events publishes domain events to other services.
package events

import (
	"context"
	"log/slog"
)

type Publisher interface {
	Publish(ctx context.Context, topic string, payload any) error
}

type logPublisher struct{ log *slog.Logger }

// NewLog publishes by logging, until a real broker is chosen.
func NewLog(l *slog.Logger) Publisher { return logPublisher{log: l} }

func (p logPublisher) Publish(ctx context.Context, topic string, payload any) error {
	p.log.InfoContext(ctx, "event", "topic", topic, "payload", payload)
	return nil
}
