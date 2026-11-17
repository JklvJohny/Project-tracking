package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/auth"
	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/config"
	"tracking-service/internal/events"
	"tracking-service/internal/httpx"
	"tracking-service/internal/project"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	var authn auth.Authenticator
	if cfg.Env == "local" {
		if authn = auth.NewLocal(); authn == nil {
			log.Fatal("ENV=local needs a build with -tags local")
		}
	} else {
		log.Fatal("no production authenticator wired")
	}
	st := memory.New(time.Now)
	userProvider := users.NewStub()
	publisher := events.NewLog(slog.Default())
	projects := project.New(st, userProvider, publisher, time.Now)
	boards := board.New(st, publisher, time.Now)
	cards := card.New(st, userProvider, publisher, time.Now)
	// Later modules mount in the same group.

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: httpx.NewRouter(func(r chi.Router) {
			r.Group(func(r chi.Router) {
				r.Use(auth.Middleware(authn))
				project.Mount(r, projects)
				board.Mount(r, boards)
				card.Mount(r, cards)
			})
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go refreshUserCache(ctx, projects)
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("listening", "port", cfg.Port, "env", cfg.Env)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// refreshUserCache keeps names in user_cache from going stale; it stops when
// ctx is cancelled at shutdown.
func refreshUserCache(ctx context.Context, p *project.Service) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := p.RefreshUserCache(ctx, 24*time.Hour); err != nil {
				slog.Error("refresh user cache", "err", err)
			} else if n > 0 {
				slog.Info("refreshed user cache", "rows", n)
			}
		}
	}
}
