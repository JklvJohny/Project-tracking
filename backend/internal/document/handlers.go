package document

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

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

// with parses one id param and passes the caller's id to h.
func with(param string, h func(w http.ResponseWriter, r *http.Request, uid, id int64) (any, int, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := idParam(r, param)
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		v, status, err := h(w, r, auth.UserID(r.Context()), id)
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		httpx.OK(w, status, v)
	}
}

// filePart advances to the part named "file" and returns it.
func filePart(mr *multipart.Reader) (*multipart.Part, error) {
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, apperr.Validation(map[string]string{"file": "required"})
		}
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				return nil, tooLarge()
			}
			return nil, apperr.BadRequest("invalid multipart body")
		}
		if p.FormName() == "file" && p.FileName() != "" {
			return p, nil
		}
	}
}

func upload(s *Service) http.HandlerFunc {
	return with("projectID", func(w http.ResponseWriter, r *http.Request, uid, pid int64) (any, int, error) {
		// the cap is enforced while reading, never after buffering
		r.Body = http.MaxBytesReader(w, r.Body, MaxFileSize+multipartOverhead)
		mr, err := r.MultipartReader()
		if err != nil {
			return nil, 0, apperr.BadRequest("expected multipart/form-data")
		}
		part, err := filePart(mr)
		if err != nil {
			return nil, 0, err
		}
		v, err := s.Upload(r.Context(), uid, pid, part.FileName(), part)
		return v, http.StatusCreated, err
	})
}

// contentDisposition is RFC 6266 inline with an RFC 5987 encoded name, so
// Thai and other non-ASCII names survive.
func contentDisposition(name string) string {
	const attrChars = "!#$&+-.^_|~"
	var b strings.Builder
	for _, c := range []byte(name) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', strings.IndexByte(attrChars, c) >= 0:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return "inline; filename*=UTF-8''" + b.String()
}

// Mount registers the document routes on r, which must sit behind the auth
// middleware.
func Mount(r chi.Router, s *Service) {
	r.Get("/projects/{projectID}/documents", with("projectID", func(_ http.ResponseWriter, req *http.Request, uid, id int64) (any, int, error) {
		v, err := s.List(req.Context(), uid, id)
		return v, http.StatusOK, err
	}))
	r.Post("/projects/{projectID}/documents", upload(s))
	r.Get("/documents/{documentID}/file", func(w http.ResponseWriter, req *http.Request) {
		id, err := idParam(req, "documentID")
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		f, err := s.Open(req.Context(), auth.UserID(req.Context()), id)
		if err != nil {
			httpx.Fail(w, req, err)
			return
		}
		defer f.Close()
		h := w.Header()
		h.Set("Content-Type", mimePDF)
		h.Set("Content-Disposition", contentDisposition(f.Name))
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "private, no-store")
		_, _ = io.Copy(w, f)
	})
	r.Delete("/documents/{documentID}", with("documentID", func(_ http.ResponseWriter, req *http.Request, uid, id int64) (any, int, error) {
		return struct{}{}, http.StatusOK, s.Delete(req.Context(), uid, id)
	}))
	r.Post("/documents/{documentID}/restore", with("documentID", func(_ http.ResponseWriter, req *http.Request, uid, id int64) (any, int, error) {
		v, err := s.Restore(req.Context(), uid, id)
		return v, http.StatusOK, err
	}))
}
