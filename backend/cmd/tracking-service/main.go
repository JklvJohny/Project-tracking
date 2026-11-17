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
	"tracking-service/internal/config"
	"tracking-service/internal/events"
	"tracking-service/internal/httpx"
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
	// Modules that consume these are mounted by later tasks.
	_, _, _, _ = authn, st, userProvider, publisher

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpx.NewRouter(func(chi.Router) {}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
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
