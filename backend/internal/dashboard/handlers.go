package dashboard

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

// Mount registers GET /dashboard on r, which must sit behind the auth
// middleware.
func Mount(r chi.Router, s *Service) {
	r.Get("/dashboard", func(w http.ResponseWriter, req *http.Request) {
		var projectID *int64
		if raw := req.URL.Query().Get("projectId"); raw != "" {
			id, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || id <= 0 {
				httpx.Fail(w, req, apperr.BadRequest("invalid projectId"))
				return
			}
			projectID = &id
		}
		v, err := s.Get(req.Context(), auth.UserID(req.Context()), projectID)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	})
}
