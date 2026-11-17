package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"tracking-service/internal/apperr"
)

const basePath = "/api/tracking/v1"

// NewRouter wires shared middleware, /healthz, and mounts modules under the API base path.
func NewRouter(mount func(chi.Router)) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, recoverJSON, middleware.Compress(5), requestLog)
	// chi's defaults are plain text; keep the envelope. 405 is reported as
	// bad_request because the API has no 405 code.
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { Fail(w, r, apperr.NotFound("route")) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		Fail(w, r, apperr.BadRequest("method not allowed"))
	})
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		OK(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Route(basePath, mount)
	return r
}

// recoverJSON replaces chi's plain-text recoverer so panics keep the envelope.
func recoverJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic", "value", v, "path", r.URL.Path)
				Fail(w, r, &apperr.Error{Code: "server_error", Msg: "internal error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", status,
			"ms", time.Since(start).Milliseconds(), "id", middleware.GetReqID(r.Context()))
	})
}
