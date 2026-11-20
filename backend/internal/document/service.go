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
	"tracking-service/internal/blob"
	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/users"
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
	up  users.Provider
	now clock.Clock
}

func New(st store.Store, bs blob.Store, up users.Provider, now clock.Clock) *Service {
	return &Service{st: st, bs: bs, up: up, now: now}
}

// View is a document as the client sees it. The storage key stays server-side.
type View struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"projectId"`
	Filename   string `json:"filename"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	UploadedBy int64  `json:"uploadedBy"`
	// UploadedByName comes from user_cache; empty when the uploader is not cached.
	UploadedByName string    `json:"uploadedByName"`
	CreatedAt      time.Time `json:"createdAt"`
}

func view(d store.Document, names map[int64]string) View {
	return View{ID: d.ID, ProjectID: d.ProjectID, Filename: d.Filename, MimeType: d.MimeType,
		SizeBytes: d.SizeBytes, UploadedBy: d.UploadedBy, UploadedByName: names[d.UploadedBy], CreatedAt: d.CreatedAt}
}

// uploaderNames maps each uploader's id to the cached display name in one read.
func uploaderNames(ctx context.Context, r store.Repos, ds []store.Document) (map[int64]string, error) {
	ids := make([]int64, 0, len(ds))
	seen := map[int64]bool{}
	for _, d := range ds {
		if !seen[d.UploadedBy] {
			seen[d.UploadedBy] = true
			ids = append(ids, d.UploadedBy)
		}
	}
	cached, err := r.Users.Get(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(cached))
	for _, u := range cached {
		out[u.UserID] = u.DisplayName
	}
	return out, nil
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

// canUpload is the access and archive check an upload shares in both of its
// transactions.
func canUpload(ctx context.Context, r store.Repos, userID, projectID int64) error {
	a, err := folderScope(ctx, r, userID, projectID)
	if err != nil {
		return err
	}
	if !a.canUpload() {
		return apperr.Forbidden()
	}
	if a.project.ArchivedAt != nil {
		return apperr.ProjectArchived()
	}
	return nil
}

// List returns the project's live documents, newest first.
func (s *Service) List(ctx context.Context, userID, projectID int64) ([]View, error) {
	out := []View{}
	err := s.st.View(ctx, func(r store.Repos) error {
		if _, err := folderScope(ctx, r, userID, projectID); err != nil {
			return err
		}
		ds, err := r.Documents.ByProject(ctx, projectID)
		if err != nil {
			return err
		}
		names, err := uploaderNames(ctx, r, ds)
		if err != nil {
			return err
		}
		for _, d := range ds {
			out = append(out, view(d, names))
		}
		return nil
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
	head, perr := br.Peek(5)
	// A body already past the request cap surfaces here when the first bytes are read: that is too large, not "not a PDF".
	var mbe *http.MaxBytesError
	if errors.As(perr, &mbe) {
		return View{}, tooLarge()
	}
	if !bytes.Equal(head, []byte("%PDF-")) {
		return View{}, notPDF()
	}
	key, err := newKey(projectID)
	if err != nil {
		return View{}, err
	}
	// one byte past the cap tells "exactly the cap" from "over it"
	size, err := s.bs.Put(ctx, key, io.LimitReader(br, MaxFileSize+1))
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

	// Best effort, like a blob cleanup: a name that is missing shows as unknown.
	found, _ := s.up.Get(ctx, []int64{userID})
	var out View
	err = s.st.Update(ctx, func(r store.Repos) error {
		if err := canUpload(ctx, r, userID, projectID); err != nil {
			return err
		}
		for _, u := range found {
			if err := r.Users.Upsert(ctx, []store.CachedUser{{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL}}); err != nil {
				return err
			}
		}
		d, err := r.Documents.Create(ctx, store.Document{
			ProjectID: projectID, StorageKey: key, Filename: CleanFilename(filename), MimeType: mimePDF,
			SizeBytes: size, UploadedBy: userID, CreatedAt: s.now(),
		})
		if err != nil {
			return err
		}
		names, err := uploaderNames(ctx, r, []store.Document{d})
		if err != nil {
			return err
		}
		out = view(d, names)
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

// resolve finds a document and the caller's access to its folder. A deleted
// document is hidden unless withDeleted (restore needs it).
func resolve(ctx context.Context, r store.Repos, userID, docID int64, withDeleted bool) (store.Document, access, error) {
	d, err := r.Documents.Get(ctx, docID)
	if errors.Is(err, store.ErrNotFound) {
		return d, access{}, apperr.NotFound("document")
	}
	if err != nil {
		return d, access{}, err
	}
	a, err := folderScope(ctx, r, userID, d.ProjectID)
	if err != nil {
		return d, a, apperr.NotFoundAs(err, "document")
	}
	if d.DeletedAt != nil && !withDeleted {
		return d, a, apperr.NotFound("document")
	}
	return d, a, nil
}

// Open returns the file for anyone who may open the folder.
func (s *Service) Open(ctx context.Context, userID, docID int64) (File, error) {
	var d store.Document
	err := s.st.View(ctx, func(r store.Repos) (err error) {
		d, _, err = resolve(ctx, r, userID, docID, false)
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

// setDeleted is Delete and Restore: the uploader (while they may still
// upload), a pm or an admin, in a live project. The blob is never touched, so
// restore can bring the file back.
func (s *Service) setDeleted(ctx context.Context, userID, docID int64, deleted bool) (View, error) {
	var out View
	err := s.st.Update(ctx, func(r store.Repos) error {
		d, a, err := resolve(ctx, r, userID, docID, !deleted)
		if err != nil {
			return err
		}
		if !a.canUpload() || (d.UploadedBy != userID && !a.canManage()) {
			return apperr.Forbidden()
		}
		if a.project.ArchivedAt != nil {
			return apperr.ProjectArchived()
		}
		names, err := uploaderNames(ctx, r, []store.Document{d})
		if err != nil {
			return err
		}
		out = view(d, names)
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
