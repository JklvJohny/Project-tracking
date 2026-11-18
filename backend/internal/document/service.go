// Package document stores project reports (PDF files). Metadata lives in the
// store; the bytes live in a blob.Store.
package document

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"tracking-service/internal/apperr"
	"tracking-service/internal/authz"
	"tracking-service/internal/blob"
	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

const (
	// MaxFileSize is the largest accepted PDF.
	MaxFileSize = 20 << 20
	// multipartOverhead is room for the multipart framing around the file, so
	// the body cap never cuts a file that is within MaxFileSize.
	multipartOverhead = 64 << 10
	maxFilename       = 200
	mimePDF           = "application/pdf"
)

type Service struct {
	st  store.Store
	bs  blob.Store
	now clock.Clock
}

func New(st store.Store, bs blob.Store, now clock.Clock) *Service {
	return &Service{st: st, bs: bs, now: now}
}

// View is a document as the client sees it. The storage key stays server-side.
type View struct {
	ID         int64     `json:"id"`
	ProjectID  int64     `json:"projectId"`
	Filename   string    `json:"filename"`
	MimeType   string    `json:"mimeType"`
	SizeBytes  int64     `json:"sizeBytes"`
	UploadedBy int64     `json:"uploadedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

func view(d store.Document) View {
	return View{ID: d.ID, ProjectID: d.ProjectID, Filename: d.Filename, MimeType: d.MimeType,
		SizeBytes: d.SizeBytes, UploadedBy: d.UploadedBy, CreatedAt: d.CreatedAt}
}

// File is a document's content, to be streamed by the caller (who closes it).
type File struct {
	Name string
	io.ReadCloser
}

func tooLarge() error { return apperr.Validation(map[string]string{"file": "too_large"}) }
func notPDF() error   { return apperr.Validation(map[string]string{"file": "not_pdf"}) }

// CleanFilename strips path parts and control characters and caps the length;
// the name is only ever a label, never a path.
func CleanFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	if rs := []rune(name); len(rs) > maxFilename {
		name = string(rs[:maxFilename])
	}
	if name = strings.TrimSpace(name); name == "" || name == "." || name == ".." {
		return "document.pdf"
	}
	return name
}

func newKey(projectID int64) (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return strconv.FormatInt(projectID, 10) + "/" + hex.EncodeToString(b[:]) + ".pdf", nil
}

// projectScope resolves the caller's role in a project: non-members get
// not_found, so a project's existence is not revealed.
func projectScope(ctx context.Context, r store.Repos, userID, projectID int64) (store.Project, authz.Role, error) {
	role, err := authz.ProjectRole(ctx, r, userID, projectID)
	if err != nil {
		return store.Project{}, "", err
	}
	p, err := r.Projects.Get(ctx, projectID)
	if errors.Is(err, store.ErrNotFound) {
		return p, "", apperr.NotFound("project")
	}
	return p, role, err
}

// canUpload is the role and archive check an upload shares in both of its
// transactions.
func canUpload(ctx context.Context, r store.Repos, userID, projectID int64) error {
	p, role, err := projectScope(ctx, r, userID, projectID)
	if err != nil {
		return err
	}
	if err := authz.Require(role, authz.EditCards); err != nil {
		return err
	}
	if p.ArchivedAt != nil {
		return apperr.ProjectArchived()
	}
	return nil
}

// List returns the project's live documents, newest first.
func (s *Service) List(ctx context.Context, userID, projectID int64) ([]View, error) {
	out := []View{}
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, _, err := projectScope(ctx, r, userID, projectID); err != nil {
			return err
		}
		ds, err := r.Documents.ByProject(ctx, projectID)
		for _, d := range ds {
			out = append(out, view(d))
		}
		return err
	})
	return out, err
}

// Upload checks the caller first (nothing is written for someone who may not
// upload), writes the blob, then the row; if the row fails the blob is removed.
func (s *Service) Upload(ctx context.Context, userID, projectID int64, filename string, content io.Reader) (View, error) {
	if err := s.st.View(ctx, func(r store.Repos) error { return canUpload(ctx, r, userID, projectID) }); err != nil {
		return View{}, err
	}
	br := bufio.NewReader(content)
	head, _ := br.Peek(5)
	if !bytes.Equal(head, []byte("%PDF-")) {
		return View{}, notPDF()
	}
	key, err := newKey(projectID)
	if err != nil {
		return View{}, err
	}
	// one byte past the cap tells "exactly the cap" from "over it"
	size, err := s.bs.Put(ctx, key, io.LimitReader(br, MaxFileSize+1))
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		return View{}, tooLarge()
	}
	if err != nil {
		return View{}, err
	}
	if size > MaxFileSize {
		s.dropBlob(ctx, key)
		return View{}, tooLarge()
	}

	var out View
	err = s.st.Update(ctx, func(r store.Repos) error {
		if err := canUpload(ctx, r, userID, projectID); err != nil {
			return err
		}
		d, err := r.Documents.Create(ctx, store.Document{
			ProjectID: projectID, StorageKey: key, Filename: CleanFilename(filename), MimeType: mimePDF,
			SizeBytes: size, UploadedBy: userID, CreatedAt: s.now(),
		})
		if err != nil {
			return err
		}
		out = view(d)
		return s.record(ctx, r, projectID, userID, "document.uploaded", d.ID)
	})
	if err != nil {
		s.dropBlob(ctx, key)
		return View{}, err
	}
	return out, nil
}

// dropBlob is best effort: an orphan blob is harmless, and a failed request
// is not made worse by it.
func (s *Service) dropBlob(ctx context.Context, key string) {
	// the request context may be the reason we are here
	_ = s.bs.Delete(context.WithoutCancel(ctx), key)
}

func (s *Service) record(ctx context.Context, r store.Repos, projectID, actor int64, typ string, docID int64) error {
	b, err := json.Marshal(map[string]any{"documentId": docID})
	if err != nil {
		return err
	}
	return r.Activity.Append(ctx, store.ActivityEvent{
		ProjectID: projectID, ActorID: actor, Type: typ, Payload: b, CreatedAt: s.now(),
	})
}

// resolve finds a document and the caller's role in its project. A deleted
// document is hidden unless withDeleted (restore needs it).
func resolve(ctx context.Context, r store.Repos, userID, docID int64, withDeleted bool) (store.Document, store.Project, authz.Role, error) {
	d, err := r.Documents.Get(ctx, docID)
	if errors.Is(err, store.ErrNotFound) {
		return d, store.Project{}, "", apperr.NotFound("document")
	}
	if err != nil {
		return d, store.Project{}, "", err
	}
	p, role, err := projectScope(ctx, r, userID, d.ProjectID)
	if err != nil {
		return d, p, role, apperr.NotFoundAs(err, "document")
	}
	if d.DeletedAt != nil && !withDeleted {
		return d, p, role, apperr.NotFound("document")
	}
	return d, p, role, nil
}

// Open returns the file for any project member or admin.
func (s *Service) Open(ctx context.Context, userID, docID int64) (File, error) {
	var d store.Document
	err := s.st.View(ctx, func(r store.Repos) (err error) {
		d, _, _, err = resolve(ctx, r, userID, docID, false)
		return err
	})
	if err != nil {
		return File{}, err
	}
	rc, err := s.bs.Open(ctx, d.StorageKey)
	if errors.Is(err, blob.ErrNotFound) {
		return File{}, apperr.NotFound("document")
	}
	if err != nil {
		return File{}, err
	}
	return File{Name: d.Filename, ReadCloser: rc}, nil
}

// setDeleted is Delete and Restore: the uploader, a pm or an admin, in a live
// project. The blob is never touched, so restore can bring the file back.
func (s *Service) setDeleted(ctx context.Context, userID, docID int64, deleted bool) (View, error) {
	var out View
	err := s.st.Update(ctx, func(r store.Repos) error {
		d, p, role, err := resolve(ctx, r, userID, docID, !deleted)
		if err != nil {
			return err
		}
		if err := authz.Require(role, authz.EditCards); err != nil {
			return err
		}
		if d.UploadedBy != userID {
			if err := authz.Require(role, authz.ManageProject); err != nil {
				return err
			}
		}
		if p.ArchivedAt != nil {
			return apperr.ProjectArchived()
		}
		out = view(d)
		if (d.DeletedAt != nil) == deleted { // restoring a live document: nothing to do
			return nil
		}
		var at *time.Time
		typ := "document.restored"
		if deleted {
			now := s.now()
			at, typ = &now, "document.deleted"
		}
		if err := r.Documents.SetDeleted(ctx, docID, at); err != nil {
			return err
		}
		return s.record(ctx, r, d.ProjectID, userID, typ, docID)
	})
	return out, err
}

func (s *Service) Delete(ctx context.Context, userID, docID int64) error {
	_, err := s.setDeleted(ctx, userID, docID, true)
	return err
}

func (s *Service) Restore(ctx context.Context, userID, docID int64) (View, error) {
	return s.setDeleted(ctx, userID, docID, false)
}
