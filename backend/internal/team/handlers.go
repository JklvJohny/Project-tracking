package team

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/httpx"
)

// Mount registers GET /team and PUT /team/{userID}/skills on r, which must sit
// behind the auth middleware.
func Mount(r chi.Router, s *Service) {
	r.Get("/team", func(w http.ResponseWriter, req *http.Request) {
		v, err := s.List(req.Context())
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	})
	r.Put("/team/{userID}/skills", func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(req, "userID"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Fail(w, req, apperr.BadRequest("invalid userID"))
			return
		}
		var in struct {
			Skills []string `json:"skills"`
		}
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		if in.Skills == nil {
			httpx.Fail(w, req, apperr.Validation(map[string]string{"skills": "required"}))
			return
		}
		skills, err := s.SetSkills(req.Context(), id, in.Skills)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, map[string]any{"skills": skills})
	})
}
