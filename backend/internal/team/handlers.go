package team

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

// Mount registers GET /team, GET /people/{userID}, PUT /team/{userID}/skills, the skill list routes
// (/team/skills) and the category routes (/team/categories) on r, which must
// sit behind the auth middleware.
func Mount(r chi.Router, s *Service) {
	mountCatalog(r, s)
	mountCategories(r, s)
	r.Get("/team", func(w http.ResponseWriter, req *http.Request) {
		v, err := s.List(req.Context())
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	})
	r.Get("/people/{userID}", func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(req, "userID"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Fail(w, req, apperr.BadRequest("invalid userID"))
			return
		}
		v, err := s.Person(req.Context(), auth.UserID(req.Context()), id)
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
			Name       string  `json:"name"`
			UserIDs    []int64 `json:"userIds"`
			CategoryID *int64  `json:"categoryId"`
		}
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.AddSkill(req.Context(), auth.UserID(req.Context()), in.Name, in.UserIDs, in.CategoryID)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	})
	// The skill name is in the body for the same reason as DELETE's query.
	r.Put("/team/skills/category", func(w http.ResponseWriter, req *http.Request) {
		var in struct {
			Name       string `json:"name"`
			CategoryID *int64 `json:"categoryId"`
		}
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.SetSkillCategory(req.Context(), auth.UserID(req.Context()), in.Name, in.CategoryID)
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

// mountCategories registers the skill category routes; each answers with the
// whole Team view so the page swaps it in without a refetch.
func mountCategories(r chi.Router, s *Service) {
	type nameIn struct {
		Name string `json:"name"`
	}
	r.Post("/team/categories", func(w http.ResponseWriter, req *http.Request) {
		var in nameIn
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		reply(w, req)(s.CreateCategory(req.Context(), auth.UserID(req.Context()), in.Name))
	})
	r.Patch("/team/categories/{categoryID}", func(w http.ResponseWriter, req *http.Request) {
		id, ok := categoryID(w, req)
		if !ok {
			return
		}
		var in nameIn
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		reply(w, req)(s.RenameCategory(req.Context(), id, in.Name))
	})
	r.Delete("/team/categories/{categoryID}", func(w http.ResponseWriter, req *http.Request) {
		if id, ok := categoryID(w, req); ok {
			reply(w, req)(s.DeleteCategory(req.Context(), id))
		}
	})
}

func categoryID(w http.ResponseWriter, req *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(req, "categoryID"), 10, 64)
	if err != nil || id <= 0 {
		httpx.Fail(w, req, apperr.BadRequest("invalid categoryID"))
		return 0, false
	}
	return id, true
}

func reply(w http.ResponseWriter, req *http.Request) func(View, error) {
	return func(v View, err error) {
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, v)
	}
}
