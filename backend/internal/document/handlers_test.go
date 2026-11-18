package document_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/auth"
	"tracking-service/internal/blob"
	"tracking-service/internal/clock"
	"tracking-service/internal/document"
	"tracking-service/internal/events"
	"tracking-service/internal/httpx"
	"tracking-service/internal/project"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
)

const (
	admin   int64 = 1
	manager int64 = 2 // system manager: creates the project, so its pm
	member  int64 = 3
	other   int64 = 4 // a second member
	outside int64 = 5
	viewer  int64 = 6
)

type headerAuth struct{}

func (headerAuth) Authenticate(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.Header.Get("X-User-ID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("no user")
	}
	return id, nil
}

type env struct {
	h    http.Handler
	st   store.Store
	mem  *memory.Store
	svc  *document.Service
	proj *project.Service
	pid  int64
	fail *bool
}

// failUpdate makes every Update fail, to prove a blob is cleaned up when the
// row cannot be written.
type failUpdate struct {
	store.Store
	fail *bool
}

func (f failUpdate) Update(ctx context.Context, fn func(store.Repos) error) error {
	if *f.fail {
		return errors.New("db down")
	}
	return f.Store.Update(ctx, fn)
}

func newEnv(t *testing.T) env {
	t.Helper()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	tick := 0
	now := clock.Clock(func() time.Time {
		tick++
		return time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC).Add(time.Duration(tick) * time.Minute)
	})
	mem := memory.New(now)
	mem.SeedUserRole(store.UserRole{UserID: admin, Role: "admin"})
	mem.SeedUserRole(store.UserRole{UserID: manager, Role: "manager"})
	up := users.NewStub()
	ev := events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil)))
	proj := project.New(mem, up, ev, now)
	ctx := context.Background()
	p, err := proj.Create(ctx, manager, project.CreateProjectInput{Name: "P", Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	for uid, role := range map[int64]string{member: "member", other: "member", viewer: "viewer"} {
		if _, err := proj.AddMember(ctx, manager, p.ID, uid, role); err != nil {
			t.Fatal(err)
		}
	}
	bs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fail := new(bool)
	var st store.Store = failUpdate{Store: mem, fail: fail}
	svc := document.New(st, bs, now)
	h := httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(headerAuth{}))
		project.Mount(r, proj)
		document.Mount(r, svc)
	})
	return env{h: h, st: st, mem: mem, svc: svc, proj: proj, pid: p.ID, fail: fail}
}

func (e env) call(user int64, method, path string, body io.Reader, ctype string) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, body)
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func multipartBody(field, filename string, content []byte) (*bytes.Buffer, string) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	hdr := textproto.MIMEHeader{}
	hdr.Set("Content-Disposition", `form-data; name="`+field+`"; filename="`+filename+`"`)
	hdr.Set("Content-Type", "application/pdf")
	part, _ := mw.CreatePart(hdr)
	_, _ = part.Write(content)
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func (e env) listPath() string { return "/projects/" + strconv.FormatInt(e.pid, 10) + "/documents" }

func (e env) upload(user int64, filename string, content []byte) (*httptest.ResponseRecorder, map[string]any) {
	b, ct := multipartBody("file", filename, content)
	return e.call(user, "POST", e.listPath(), b, ct)
}

func (e env) docEvents() string {
	var kinds []string
	for _, ev := range e.mem.Activity() {
		if strings.HasPrefix(ev.Type, "document.") {
			kinds = append(kinds, ev.Type)
		}
	}
	return strings.Join(kinds, ",")
}

func pdf(extra string) []byte { return []byte("%PDF-1.4\n" + extra) }

func idStr(body map[string]any) string {
	return strconv.FormatInt(int64(data(body)["id"].(float64)), 10)
}

func data(body map[string]any) map[string]any { d, _ := body["data"].(map[string]any); return d }

func fieldOf(body map[string]any, name string) any {
	f, _ := body["fields"].(map[string]any)
	return f[name]
}

func TestUpload_OK(t *testing.T) {
	e := newEnv(t)
	rec, body := e.upload(member, "Weekly Report W46.pdf", pdf("hello"))
	if rec.Code != 201 {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	d := data(body)
	if d["filename"] != "Weekly Report W46.pdf" || d["mimeType"] != "application/pdf" ||
		d["sizeBytes"].(float64) != float64(len(pdf("hello"))) || d["uploadedBy"].(float64) != float64(member) {
		t.Errorf("document = %v", d)
	}
	if _, leaked := d["storageKey"]; leaked {
		t.Error("storage key must not reach the client")
	}
	rec, body = e.call(viewer, "GET", e.listPath(), nil, "")
	if list, _ := body["data"].([]any); rec.Code != 200 || len(list) != 1 {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	if got := e.docEvents(); got != "document.uploaded" {
		t.Errorf("events = %q", got)
	}
}

func TestUpload_FileNameIsCleaned(t *testing.T) {
	e := newEnv(t)
	_, body := e.upload(member, "..\\..\\evil"+strings.Repeat("a", 300)+".pdf", pdf(""))
	name, _ := data(body)["filename"].(string)
	if !strings.HasPrefix(name, "evil") || strings.ContainsAny(name, "/\\") || len([]rune(name)) > 200 {
		t.Errorf("filename = %q", name)
	}
	if got := document.CleanFilename("a\x01b\x7f/c\td.pdf"); got != "cd.pdf" {
		t.Errorf("control chars and path kept: %q", got)
	}
	if got := document.CleanFilename(" .. "); got != "document.pdf" {
		t.Errorf("empty name fallback = %q", got)
	}
}

func TestUpload_NotPDF(t *testing.T) {
	e := newEnv(t)
	for _, c := range [][]byte{[]byte("<html>hi</html>"), []byte("%PD"), {}} {
		rec, body := e.upload(member, "x.pdf", c)
		if rec.Code != 422 || body["code"] != "validation_failed" || fieldOf(body, "file") != "not_pdf" {
			t.Errorf("%q: %d %s", c, rec.Code, rec.Body)
		}
	}
}

func TestUpload_MissingFileField(t *testing.T) {
	e := newEnv(t)
	b, ct := multipartBody("other", "x.pdf", pdf(""))
	rec, body := e.call(member, "POST", e.listPath(), b, ct)
	if rec.Code != 422 || fieldOf(body, "file") != "required" {
		t.Errorf("missing field: %d %s", rec.Code, rec.Body)
	}
	rec, _ = e.call(member, "POST", e.listPath(), strings.NewReader("{}"), "application/json")
	if rec.Code != 400 {
		t.Errorf("not multipart = %d, want 400", rec.Code)
	}
}

func TestUpload_TooLarge(t *testing.T) {
	e := newEnv(t)
	big := append(pdf(""), bytes.Repeat([]byte("a"), document.MaxFileSize)...)
	rec, body := e.upload(member, "big.pdf", big)
	if rec.Code != 422 || fieldOf(body, "file") != "too_large" {
		t.Fatalf("oversize = %d %.200s", rec.Code, rec.Body)
	}
	_, list := e.call(member, "GET", e.listPath(), nil, "")
	if l, _ := list["data"].([]any); len(l) != 0 {
		t.Error("an oversize upload must leave no row")
	}
}

func TestUpload_ViewerForbidden_NonMemberNotFound(t *testing.T) {
	e := newEnv(t)
	if rec, _ := e.upload(viewer, "x.pdf", pdf("")); rec.Code != 403 {
		t.Errorf("viewer upload = %d", rec.Code)
	}
	rec, body := e.upload(outside, "x.pdf", pdf(""))
	if rec.Code != 404 || body["code"] != "not_found" {
		t.Errorf("non-member upload = %d %s", rec.Code, rec.Body)
	}
	// even a bad file tells an outsider nothing but not_found
	if rec, _ := e.upload(outside, "x.pdf", []byte("nope")); rec.Code != 404 {
		t.Errorf("non-member bad file = %d", rec.Code)
	}
}

func TestNonMember_ListAndFileNotFound(t *testing.T) {
	e := newEnv(t)
	_, body := e.upload(member, "x.pdf", pdf(""))
	id := idStr(body)
	for _, rc := range []struct{ m, p string }{
		{"GET", e.listPath()},
		{"GET", "/documents/" + id + "/file"},
		{"DELETE", "/documents/" + id},
		{"POST", "/documents/" + id + "/restore"},
	} {
		rec, b := e.call(outside, rc.m, rc.p, nil, "")
		if rec.Code != 404 || b["code"] != "not_found" {
			t.Errorf("%s %s = %d %s", rc.m, rc.p, rec.Code, rec.Body)
		}
	}
	if rec, _ := e.call(outside, "GET", "/documents/9999/file", nil, ""); rec.Code != 404 {
		t.Errorf("missing document = %d", rec.Code)
	}
	if rec, _ := e.call(admin, "GET", "/documents/"+id+"/file", nil, ""); rec.Code != 200 {
		t.Errorf("admin non-member download = %d, want 200", rec.Code)
	}
}

func TestFile_StreamsWithHeaders(t *testing.T) {
	e := newEnv(t)
	content := pdf("body bytes")
	_, body := e.upload(member, "รายงาน (v1).pdf", content)
	rec, _ := e.call(viewer, "GET", "/documents/"+idStr(body)+"/file", nil, "")
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), content) {
		t.Fatalf("file = %d %q", rec.Code, rec.Body)
	}
	h := rec.Header()
	if h.Get("Content-Type") != "application/pdf" || h.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("headers = %v", h)
	}
	want := "inline; filename*=UTF-8''%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%87%E0%B8%B2%E0%B8%99%20%28v1%29.pdf"
	if h.Get("Content-Disposition") != want {
		t.Errorf("Content-Disposition = %q, want %q", h.Get("Content-Disposition"), want)
	}
}

func TestDelete_Permissions_AndRestore(t *testing.T) {
	e := newEnv(t)
	_, body := e.upload(member, "x.pdf", pdf(""))
	id := idStr(body)

	if rec, _ := e.call(other, "DELETE", "/documents/"+id, nil, ""); rec.Code != 403 {
		t.Errorf("non-uploader member delete = %d, want 403", rec.Code)
	}
	if rec, _ := e.call(viewer, "DELETE", "/documents/"+id, nil, ""); rec.Code != 403 {
		t.Errorf("viewer delete = %d, want 403", rec.Code)
	}
	if rec, _ := e.call(member, "DELETE", "/documents/"+id, nil, ""); rec.Code != 200 {
		t.Fatalf("uploader delete = %d", rec.Code)
	}
	if _, b := e.call(member, "GET", e.listPath(), nil, ""); len(b["data"].([]any)) != 0 {
		t.Error("deleted document still listed")
	}
	if rec, _ := e.call(member, "GET", "/documents/"+id+"/file", nil, ""); rec.Code != 404 {
		t.Errorf("deleted file download = %d, want 404", rec.Code)
	}
	if rec, _ := e.call(other, "POST", "/documents/"+id+"/restore", nil, ""); rec.Code != 403 {
		t.Errorf("non-uploader restore = %d, want 403", rec.Code)
	}
	rec, b := e.call(member, "POST", "/documents/"+id+"/restore", nil, "")
	if rec.Code != 200 || data(b)["filename"] != "x.pdf" {
		t.Fatalf("restore = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := e.call(member, "GET", "/documents/"+id+"/file", nil, ""); rec.Code != 200 {
		t.Errorf("restored file download = %d: the blob must survive a soft delete", rec.Code)
	}
	if rec, _ := e.call(manager, "DELETE", "/documents/"+id, nil, ""); rec.Code != 200 {
		t.Errorf("pm delete of another's file = %d", rec.Code)
	}
	if got := e.docEvents(); got != "document.uploaded,document.deleted,document.restored,document.deleted" {
		t.Errorf("events = %q", got)
	}
}

func TestArchivedProject_ReadOnly(t *testing.T) {
	e := newEnv(t)
	_, body := e.upload(member, "x.pdf", pdf(""))
	id := idStr(body)
	if _, err := e.proj.Archive(context.Background(), manager, e.pid); err != nil {
		t.Fatal(err)
	}
	rec, b := e.upload(member, "y.pdf", pdf(""))
	if rec.Code != 409 || b["error"] != "project_archived" {
		t.Errorf("archived upload = %d %s", rec.Code, rec.Body)
	}
	rec, b = e.call(member, "DELETE", "/documents/"+id, nil, "")
	if rec.Code != 409 || b["error"] != "project_archived" {
		t.Errorf("archived delete = %d %s", rec.Code, rec.Body)
	}
	if rec, _ := e.call(member, "GET", "/documents/"+id+"/file", nil, ""); rec.Code != 200 {
		t.Errorf("an archived project is still readable: %d", rec.Code)
	}
}

type countingBlob struct {
	blob.Store
	puts int
	live map[string]bool
}

func (c *countingBlob) Put(ctx context.Context, key string, r io.Reader) (int64, error) {
	c.puts++
	if c.live == nil {
		c.live = map[string]bool{}
	}
	c.live[key] = true
	return c.Store.Put(ctx, key, r)
}

func (c *countingBlob) Delete(ctx context.Context, key string) error {
	delete(c.live, key)
	return c.Store.Delete(ctx, key)
}

func TestUpload_BlobRemovedWhenRowFails(t *testing.T) {
	e := newEnv(t)
	bs, _ := blob.NewLocal(t.TempDir())
	counting := &countingBlob{Store: bs}
	svc := document.New(e.st, counting, time.Now)
	*e.fail = true
	if _, err := svc.Upload(context.Background(), member, e.pid, "x.pdf", bytes.NewReader(pdf(""))); err == nil {
		t.Fatal("want error")
	}
	if counting.puts != 1 || len(counting.live) != 0 {
		t.Errorf("puts=%d live=%v: the blob must be deleted when the row insert fails", counting.puts, counting.live)
	}
}

func mustWrite(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o640); err != nil {
		t.Fatal(err)
	}
}

func TestSeedFromDir(t *testing.T) {
	e := newEnv(t)
	root := t.TempDir()
	folders := map[string]int64{"website-redesign": e.pid, "mobile-app-v2": e.pid + 1}
	if n, err := document.SeedFromDir(context.Background(), e.svc, root+"/missing", folders, manager); err != nil || n != 0 {
		t.Fatalf("an absent dir must be skipped silently: %d, %v", n, err)
	}
	mustWrite(t, root+"/website-redesign/A.pdf", pdf("a"))
	mustWrite(t, root+"/website-redesign/notes.txt", []byte("skip"))
	mustWrite(t, root+"/website-redesign/B.pdf", []byte("not a pdf"))
	n, err := document.SeedFromDir(context.Background(), e.svc, root, folders, manager)
	if err != nil || n != 1 {
		t.Fatalf("seed = %d, %v (want 1: only the valid pdf)", n, err)
	}
	_, b := e.call(member, "GET", e.listPath(), nil, "")
	if l := b["data"].([]any); len(l) != 1 || l[0].(map[string]any)["filename"] != "A.pdf" {
		t.Errorf("list = %v", l)
	}
}
