package board

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

func idParam(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.BadRequest("invalid " + name)
	}
	return id, nil
}

func respond(w http.ResponseWriter, r *http.Request, status int, data any, err error) {
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.OK(w, status, data)
}

// with parses one id param and passes the caller's id to h.
func with(param string, h func(w http.ResponseWriter, r *http.Request, uid, id int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := idParam(r, param)
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		h(w, r, auth.UserID(r.Context()), id)
	}
}

// Mount registers the board and list routes on r, which must sit behind the
// auth middleware. Routes are flat (no r.Route("/projects/{projectID}")) so
// they coexist with the project module's subrouter.
func Mount(r chi.Router, s *Service) {
	r.Get("/projects/{projectID}/board", with("projectID", func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
		v, role, err := s.Board(req.Context(), uid, pid)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		if httpx.ETag(w, req, v.Board.UpdatedAt.Format(time.RFC3339Nano), string(role)) {
			return
		}
		httpx.OK(w, http.StatusOK, v)
	}))
	r.Get("/projects/{projectID}/archived", with("projectID", func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
		v, err := s.Archived(req.Context(), uid, pid)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Post("/projects/{projectID}/lists", with("projectID", func(w http.ResponseWriter, req *http.Request, uid, pid int64) {
		var in struct {
			Name string `json:"name"`
		}
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.CreateList(req.Context(), uid, pid, in.Name)
		respond(w, req, http.StatusCreated, v, err)
	}))
	r.Patch("/lists/{listID}", with("listID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		var in UpdateListInput
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.UpdateList(req.Context(), uid, id, in)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Post("/lists/{listID}/move", with("listID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		var in MoveInput
		if err := httpx.Decode(req, &in); err != nil {
			httpx.Fail(w, req, err)
			return
		}
		v, err := s.MoveList(req.Context(), uid, id, in)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Post("/lists/{listID}/archive", with("listID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		v, err := s.ArchiveList(req.Context(), uid, id)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Post("/lists/{listID}/restore", with("listID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		v, err := s.RestoreList(req.Context(), uid, id)
		respond(w, req, http.StatusOK, v, err)
	}))
}
