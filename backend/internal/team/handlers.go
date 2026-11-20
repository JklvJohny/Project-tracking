package team

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

// Mount registers GET /team, PUT /team/{userID}/skills and the skill list
// routes (POST and DELETE /team/skills) on r, which must sit behind the auth
// middleware.
func Mount(r chi.Router, s *Service) {
	mountCatalog(r, s)
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

// mountCatalog registers the department skill list routes. The name travels
// in the query on DELETE because skills like "CI/CD" contain a slash.
func mountCatalog(r chi.Router, s *Service) {
	r.Post("/team/skills", func(w http.ResponseWriter, req *http.Request) {
		var in struct {
			Name    string  `json:"name"`
			UserIDs []int64 `json:"userIds"`
		}
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.AddSkill(req.Context(), auth.UserID(req.Context()), in.Name, in.UserIDs)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	})
	r.Delete("/team/skills", func(w http.ResponseWriter, req *http.Request) {
		if err := s.RemoveSkill(req.Context(), req.URL.Query().Get("name")); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, map[string]any{})
	})
}
