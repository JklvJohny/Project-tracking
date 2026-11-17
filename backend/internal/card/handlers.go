package card

import (
	"net/http"
	"strconv"

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

// withBody is with plus a strict JSON body decoded into T.
func withBody[T any](param string, status int, h func(r *http.Request, uid, id int64, in T) (CardDetail, error)) http.HandlerFunc {
	return with(param, func(w http.ResponseWriter, r *http.Request, uid, id int64) {
		var in T
		if err := httpx.Decode(r, &in); err != nil {
			httpx.Fail(w, r, err)
			return
		}
		v, err := h(r, uid, id, in)
		respond(w, r, status, v, err)
	})
}

// assignee runs fn for /cards/{cardID}/assignees/{userID}.
func assignee(fn func(r *http.Request, uid, cardID, memberID int64) (CardDetail, error)) http.HandlerFunc {
	return with("cardID", func(w http.ResponseWriter, r *http.Request, uid, id int64) {
		mid, err := idParam(r, "userID")
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		v, err := fn(r, uid, id, mid)
		respond(w, r, http.StatusOK, v, err)
	})
}

// label runs fn for /cards/{cardID}/labels/{labelID}.
func label(fn func(r *http.Request, uid, cardID, labelID int64) (CardDetail, error)) http.HandlerFunc {
	return with("cardID", func(w http.ResponseWriter, r *http.Request, uid, id int64) {
		lid, err := idParam(r, "labelID")
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		v, err := fn(r, uid, id, lid)
		respond(w, r, http.StatusOK, v, err)
	})
}

// Mount registers the card routes on r, which must sit behind the auth
// middleware. Routes are flat so they coexist with the project and board
// routers.
func Mount(r chi.Router, s *Service) {
	r.Post("/lists/{listID}/cards", withBody("listID", http.StatusCreated,
		func(req *http.Request, uid, id int64, in CreateCardInput) (CardDetail, error) {
			return s.Create(req.Context(), uid, id, in)
		}))
	r.Get("/cards/{cardID}", with("cardID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		v, err := s.Get(req.Context(), uid, id)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Patch("/cards/{cardID}", withBody("cardID", http.StatusOK,
		func(req *http.Request, uid, id int64, in UpdateCardInput) (CardDetail, error) {
			return s.Update(req.Context(), uid, id, in)
		}))
	r.Post("/cards/{cardID}/move", withBody("cardID", http.StatusOK,
		func(req *http.Request, uid, id int64, in MoveCardInput) (CardDetail, error) {
			return s.Move(req.Context(), uid, id, in)
		}))
	r.Post("/cards/{cardID}/archive", with("cardID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		v, err := s.Archive(req.Context(), uid, id)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Post("/cards/{cardID}/restore", with("cardID", func(w http.ResponseWriter, req *http.Request, uid, id int64) {
		v, err := s.Restore(req.Context(), uid, id)
		respond(w, req, http.StatusOK, v, err)
	}))
	r.Put("/cards/{cardID}/assignees/{userID}", assignee(func(req *http.Request, uid, cardID, memberID int64) (CardDetail, error) {
		return s.Assign(req.Context(), uid, cardID, memberID)
	}))
	r.Delete("/cards/{cardID}/assignees/{userID}", assignee(func(req *http.Request, uid, cardID, memberID int64) (CardDetail, error) {
		return s.Unassign(req.Context(), uid, cardID, memberID)
	}))
	r.Put("/cards/{cardID}/labels/{labelID}", label(func(req *http.Request, uid, cardID, labelID int64) (CardDetail, error) {
		return s.AddLabel(req.Context(), uid, cardID, labelID)
	}))
	r.Delete("/cards/{cardID}/labels/{labelID}", label(func(req *http.Request, uid, cardID, labelID int64) (CardDetail, error) {
		return s.RemoveLabel(req.Context(), uid, cardID, labelID)
	}))
}
