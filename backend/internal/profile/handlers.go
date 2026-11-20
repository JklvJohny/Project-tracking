package profile

import (
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/apperr"
	"tracking-service/internal/auth"
	"tracking-service/internal/httpx"
)

// Mount registers PUT and DELETE /me/avatar and GET /users/{userID}/avatar on
// r, which must sit behind the auth middleware.
func Mount(r chi.Router, s *Service) {
	r.Put("/me/avatar", func(w http.ResponseWriter, req *http.Request) {
		// Headroom over MaxUpload for the multipart framing; normalize enforces the real limit.
		req.Body = http.MaxBytesReader(w, req.Body, MaxUpload+64<<10)
		mr, err := req.MultipartReader()
		if err != nil {
			httpx.Fail(w, req, apperr.BadRequest("multipart body required"))
			return
		}
		for {
			p, err := mr.NextPart()
			if err == io.EOF {
				httpx.Fail(w, req, fileErr("required"))
				return
			}
			if err != nil {
				httpx.Fail(w, req, fileErr("too_large"))
				return
			}
			if p.FormName() != "file" {
				continue
			}
			url, err := s.SetAvatar(req.Context(), auth.UserID(req.Context()), p)
			if err != nil {
				httpx.Fail(w, req, err)
				return
			}
			httpx.OK(w, http.StatusOK, map[string]string{"avatarUrl": url})
			return
		}
	})
	r.Delete("/me/avatar", func(w http.ResponseWriter, req *http.Request) {
		url, err := s.DeleteAvatar(req.Context(), auth.UserID(req.Context()))
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		httpx.OK(w, http.StatusOK, map[string]string{"avatarUrl": url})
	})
	r.Get("/users/{userID}/avatar", func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(req, "userID"), 10, 64)
		if err != nil || id <= 0 {
			httpx.Fail(w, req, apperr.BadRequest("invalid userID"))
			return
		}
		rc, err := s.Open(req.Context(), id)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		defer rc.Close()
		h := w.Header()
		h.Set("Content-Type", "image/jpeg")
		h.Set("X-Content-Type-Options", "nosniff")
		// The URL carries a version (?v=), so one URL never changes; private because it sits behind auth.
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, rc)
	})
}
