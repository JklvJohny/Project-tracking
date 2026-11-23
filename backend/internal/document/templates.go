package document

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"tracking-service/internal/apperr"
	"tracking-service/internal/blob"
	"tracking-service/internal/store"
	"tracking-service/internal/validate"
)

// Report templates are department-wide files people download, fill in and
// then upload as a project report. Any signed-in user may add, edit, delete
// and restore them (the owner's call); deletes are soft, so Undo works.

const (
	maxCategory    = 60
	maxTplName     = 120
	maxDescription = 500
)

// ole2 starts every legacy Office file (.doc, .xls, .ppt): the OLE2 compound
// file signature.
var ole2 = []byte("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1")

// templateTypes maps an allowed extension to the MIME type served and the
// magic bytes the content must start with. Office files are ZIP containers;
// the pre-2007 Office formats are OLE2 containers, kept because departments
// still hold forms in them.
var templateTypes = map[string]struct {
	mime  string
	magic []byte
}{
	".pdf":  {"application/pdf", []byte("%PDF-")},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("PK\x03\x04")},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []byte("PK\x03\x04")},
	".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", []byte("PK\x03\x04")},
	".doc":  {"application/msword", ole2},
	".xls":  {"application/vnd.ms-excel", ole2},
	".ppt":  {"application/vnd.ms-powerpoint", ole2},
}

// TemplateView is a template as the client sees it. The storage key stays server-side.
type TemplateView struct {
	ID             int64     `json:"id"`
	Category       string    `json:"category"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Filename       string    `json:"filename"`
	MimeType       string    `json:"mimeType"`
	SizeBytes      int64     `json:"sizeBytes"`
	UploadedBy     int64     `json:"uploadedBy"`
	UploadedByName string    `json:"uploadedByName"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// TemplateDetails are the editable fields, shared by upload and edit so an
// edit cannot skip a rule the upload enforces.
type TemplateDetails struct {
	Category    *string `json:"category"`
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func templateView(t store.ReportTemplate, names map[int64]string) TemplateView {
	return TemplateView{ID: t.ID, Category: t.Category, Name: t.Name, Description: t.Description,
		Filename: t.Filename, MimeType: t.MimeType, SizeBytes: t.SizeBytes, UploadedBy: t.UploadedBy,
		UploadedByName: names[t.UploadedBy], CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt}
}

func templateNames(ctx context.Context, r store.Repos, ts []store.ReportTemplate) (map[int64]string, error) {
	ds := make([]store.Document, len(ts))
	for i, t := range ts {
		ds[i] = store.Document{UploadedBy: t.UploadedBy}
	}
	return uploaderNames(ctx, r, ds)
}

// applyDetails trims and validates d onto t. Category and name are required;
// lengths are in characters, not bytes, so Thai text gets the same room.
func applyDetails(t *store.ReportTemplate, d TemplateDetails) error {
	fields := map[string]string{}
	set := func(dst *string, v *string, field string, max int, required bool) {
		if v == nil {
			return
		}
		s := strings.TrimSpace(*v)
		switch {
		case required && s == "":
			fields[field] = "required"
		case !validate.Storable(s):
			fields[field] = "invalid"
		case utf8.RuneCountInString(s) > max:
			fields[field] = "too_long"
		default:
			*dst = s
		}
	}
	set(&t.Category, d.Category, "category", maxCategory, true)
	set(&t.Name, d.Name, "name", maxTplName, true)
	set(&t.Description, d.Description, "description", maxDescription, false)
	if t.Category == "" && fields["category"] == "" {
		fields["category"] = "required"
	}
	if t.Name == "" && fields["name"] == "" {
		fields["name"] = "required"
	}
	if len(fields) > 0 {
		return apperr.Validation(fields)
	}
	return nil
}

func templateKey(ext string) (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "templates/" + hex.EncodeToString(b[:]) + ext, nil
}

// ListTemplates returns every live template, grouped by category then name.
func (s *Service) ListTemplates(ctx context.Context) ([]TemplateView, error) {
	out := []TemplateView{}
	err := s.st.View(ctx, func(r store.Repos) error {
		ts, err := r.Templates.List(ctx)
		if err != nil {
			return err
		}
		names, err := templateNames(ctx, r, ts)
		if err != nil {
			return err
		}
		for _, t := range ts {
			out = append(out, templateView(t, names))
		}
		return nil
	})
	return out, err
}

// UploadTemplate validates the details and the file type before anything is
// written, then stores the blob and the row; a failed row removes the blob.
// An empty name defaults to the file name without its extension.
func (s *Service) UploadTemplate(ctx context.Context, userID int64, d TemplateDetails, filename string, content io.Reader) (TemplateView, error) {
	clean := CleanFilename(filename)
	ext := strings.ToLower(path.Ext(clean))
	typ, ok := templateTypes[ext]
	if !ok {
		return TemplateView{}, apperr.Validation(map[string]string{"file": "unsupported_type"})
	}
	if d.Name == nil || strings.TrimSpace(*d.Name) == "" {
		// The file name may be longer than a name may be: the user typed no
		// name, so cut it rather than answer "name too long".
		n := strings.TrimSuffix(clean, path.Ext(clean))
		if rs := []rune(n); len(rs) > maxTplName {
			n = strings.TrimSpace(string(rs[:maxTplName]))
		}
		d.Name = &n
	}
	t := store.ReportTemplate{UploadedBy: userID}
	if err := applyDetails(&t, d); err != nil {
		return TemplateView{}, err
	}

	br := bufio.NewReader(content)
	head, perr := br.Peek(len(typ.magic))
	var mbe *http.MaxBytesError
	if errors.As(perr, &mbe) {
		return TemplateView{}, tooLarge()
	}
	// The extension alone is a claim; the first bytes must agree with it.
	if !bytes.Equal(head, typ.magic) {
		return TemplateView{}, apperr.Validation(map[string]string{"file": "unsupported_type"})
	}
	key, err := templateKey(ext)
	if err != nil {
		return TemplateView{}, err
	}
	size, err := s.bs.Put(ctx, key, io.LimitReader(br, MaxFileSize+1))
	if errors.As(err, &mbe) {
		return TemplateView{}, tooLarge()
	}
	if err != nil {
		return TemplateView{}, err
	}
	if size > MaxFileSize {
		s.dropBlob(ctx, key)
		return TemplateView{}, tooLarge()
	}

	found, _ := s.up.Get(ctx, []int64{userID})
	now := s.now()
	t.StorageKey, t.Filename, t.MimeType, t.SizeBytes, t.CreatedAt, t.UpdatedAt = key, clean, typ.mime, size, now, now
	var out TemplateView
	err = s.st.Update(ctx, func(r store.Repos) error {
		for _, u := range found {
			if err := r.Users.Upsert(ctx, []store.CachedUser{{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL}}); err != nil {
				return err
			}
		}
		created, err := r.Templates.Create(ctx, t)
		if err != nil {
			return err
		}
		names, err := templateNames(ctx, r, []store.ReportTemplate{created})
		if err != nil {
			return err
		}
		out = templateView(created, names)
		return nil
	})
	if err != nil {
		s.dropBlob(ctx, key)
		return TemplateView{}, err
	}
	return out, nil
}

func getTemplate(ctx context.Context, r store.Repos, id int64, withDeleted bool) (store.ReportTemplate, error) {
	t, err := r.Templates.Get(ctx, id)
	if errors.Is(err, store.ErrNotFound) || (err == nil && t.DeletedAt != nil && !withDeleted) {
		return t, apperr.NotFound("template")
	}
	return t, err
}

// UpdateTemplate edits the details only; the file is replaced by uploading anew.
func (s *Service) UpdateTemplate(ctx context.Context, id int64, d TemplateDetails) (TemplateView, error) {
	var out TemplateView
	err := s.st.Update(ctx, func(r store.Repos) error {
		t, err := getTemplate(ctx, r, id, false)
		if err != nil {
			return err
		}
		if err := applyDetails(&t, d); err != nil {
			return err
		}
		t.UpdatedAt = s.now()
		if err := r.Templates.SaveDetails(ctx, t); err != nil {
			return err
		}
		names, err := templateNames(ctx, r, []store.ReportTemplate{t})
		if err != nil {
			return err
		}
		out = templateView(t, names)
		return nil
	})
	return out, err
}

// OpenTemplate returns the file of a live template.
func (s *Service) OpenTemplate(ctx context.Context, id int64) (File, string, error) {
	var t store.ReportTemplate
	err := s.st.View(ctx, func(r store.Repos) (err error) {
		t, err = getTemplate(ctx, r, id, false)
		return err
	})
	if err != nil {
		return File{}, "", err
	}
	rc, err := s.bs.Open(ctx, t.StorageKey)
	if errors.Is(err, blob.ErrNotFound) {
		return File{}, "", apperr.NotFound("template")
	}
	if err != nil {
		return File{}, "", err
	}
	return File{Name: t.Filename, ReadCloser: rc}, t.MimeType, nil
}

// SetTemplateDeleted is Delete and Restore. The blob is kept, so a restore
// brings the file back.
func (s *Service) SetTemplateDeleted(ctx context.Context, id int64, deleted bool) (TemplateView, error) {
	var out TemplateView
	err := s.st.Update(ctx, func(r store.Repos) error {
		t, err := getTemplate(ctx, r, id, !deleted)
		if err != nil {
			return err
		}
		names, err := templateNames(ctx, r, []store.ReportTemplate{t})
		if err != nil {
			return err
		}
		out = templateView(t, names)
		if (t.DeletedAt != nil) == deleted {
			return nil
		}
		var at *time.Time
		if deleted {
			now := s.now()
			at = &now
		}
		return r.Templates.SetDeleted(ctx, id, at)
	})
	return out, err
}
