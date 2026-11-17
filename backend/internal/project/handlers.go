package project

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

func trim(s string) string { return strings.TrimSpace(s) }

func idParam(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.BadRequest("invalid " + name)
	}
	return id, nil
}

// Mount registers the Me, Projects and Members routes on r, which must sit
// behind the auth middleware.
func Mount(r chi.Router, s *Service) {
	r.Get("/me", func(w http.ResponseWriter, req *http.Request) {
		v, err := s.Me(req.Context(), auth.UserID(req.Context()))
		respond(w, req, http.StatusOK, v, err)
	})
	r.Get("/users", func(w http.ResponseWriter, req *http.Request) {
		v, err := s.SearchUsers(req.Context(), req.URL.Query().Get("q"))
		respond(w, req, http.StatusOK, v, err)
	})

	r.Get("/projects", func(w http.ResponseWriter, req *http.Request) {
		v, err := s.List(req.Context(), auth.UserID(req.Context()))
		respond(w, req, http.StatusOK, v, err)
	})
	r.Post("/projects", func(w http.ResponseWriter, req *http.Request) {
		var in CreateProjectInput
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.Create(req.Context(), auth.UserID(req.Context()), in)
		respond(w, req, http.StatusCreated, v, err)
	})

	r.Route("/projects/{projectID}", func(r chi.Router) {
		r.Get("/", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			v, err := s.Get(req.Context(), uid, pid)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Patch("/", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			var in UpdateProjectInput
			if err := httpx.Decode(req, &in); err != nil {
				httpx.Fail(w, req, err)
				return
			}
			v, err := s.Update(req.Context(), uid, pid, in)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Post("/archive", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			v, err := s.Archive(req.Context(), uid, pid)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Post("/restore", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			v, err := s.Restore(req.Context(), uid, pid)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Get("/members", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			v, err := s.Members(req.Context(), uid, pid)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Post("/members", withProject(func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
			var in struct {
				UserID int64  `json:"userId"`
				Role   string `json:"role"`
			}
			if err := httpx.Decode(req, &in); err != nil {
				httpx.Fail(w, req, err)
				return
			}
			v, err := s.AddMember(req.Context(), uid, pid, in.UserID, in.Role)
			respond(w, req, http.StatusCreated, v, err)
		}))
		r.Patch("/members/{userID}", withMember(func(w http.ResponseWriter, req *http.Request, uid, pid, mid int64) {
			var in struct {
				Role string `json:"role"`
			}
			if err := httpx.Decode(req, &in); err != nil {
				httpx.Fail(w, req, err)
				return
			}
			v, err := s.SetRole(req.Context(), uid, pid, mid, in.Role)
			respond(w, req, http.StatusOK, v, err)
		}))
		r.Delete("/members/{userID}", withMember(func(w http.ResponseWriter, req *http.Request, uid, pid, mid int64) {
			err := s.RemoveMember(req.Context(), uid, pid, mid)
			respond(w, req, http.StatusOK, map[string]any{}, err)
		}))
	})
}

func respond(w http.ResponseWriter, r *http.Request, status int, data any, err error) {
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.OK(w, status, data)
}

func withProject(h func(w http.ResponseWriter, r *http.Request, uid, pid int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pid, err := idParam(r, "projectID")
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		h(w, r, auth.UserID(r.Context()), pid)
	}
}

func withMember(h func(w http.ResponseWriter, r *http.Request, uid, pid, mid int64)) http.HandlerFunc {
	return withProject(func(w http.ResponseWriter, r *http.Request, uid, pid int64) {
		mid, err := idParam(r, "userID")
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		h(w, r, uid, pid, mid)
	})
}
