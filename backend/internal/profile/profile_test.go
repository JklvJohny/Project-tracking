package profile_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"tracking-service/internal/auth"
	"tracking-service/internal/blob"
	"tracking-service/internal/events"
	"tracking-service/internal/httpx"
	"tracking-service/internal/profile"
	"tracking-service/internal/project"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/users"
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
	dir  string
	proj *project.Service
}

func newEnv(t *testing.T) env {
	t.Helper()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	tick := 0
	now := func() time.Time {
		tick++
		return time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC).Add(time.Duration(tick) * time.Second)
	}
	st := memory.New(now)
	dir := t.TempDir()
	blobs, err := blob.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw := users.NewStub()
	idx := profile.NewIndex()
	up := idx.Wrap(raw)
	proj := project.New(st, up, events.NewLog(slog.Default()), now)
	h := httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(headerAuth{}))
		project.Mount(r, proj)
		profile.Mount(r, profile.New(st, blobs, raw, idx, now))
	})
	return env{h: h, dir: dir, proj: proj}
}

func (e env) do(user int64, method, path string, body io.Reader, ctype string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/api/tracking/v1"+path, body)
	req.Header.Set("X-User-ID", strconv.FormatInt(user, 10))
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func (e env) upload(user int64, name string, content []byte) (*httptest.ResponseRecorder, map[string]any) {
	var b bytes.Buffer
	mw := multipart.NewWriter(&b)
	fw, _ := mw.CreateFormFile("file", name)
	_, _ = fw.Write(content)
	_ = mw.Close()
	rec := e.do(user, "PUT", "/me/avatar", &b, mw.FormDataContentType())
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func pngOf(w, h int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		for y := range h {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: 80, B: 160, A: 255})
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func meAvatar(t *testing.T, e env, user int64) string {
	t.Helper()
	rec := e.do(user, "GET", "/me", nil, "")
	var out struct {
		Data struct {
			User struct {
				AvatarURL string `json:"avatarUrl"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || rec.Code != 200 {
		t.Fatalf("GET /me = %d %s", rec.Code, rec.Body)
	}
	return out.Data.User.AvatarURL
}

func TestAvatar_UploadIsRedrawnServedAndShownEverywhere(t *testing.T) {
	e := newEnv(t)
	before := meAvatar(t, e, 3)
	rec, body := e.upload(3, "me.png", pngOf(800, 400))
	if rec.Code != 200 {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	url := body["data"].(map[string]any)["avatarUrl"].(string)
	if !strings.HasPrefix(url, "/api/tracking/v1/users/3/avatar?v=") {
		t.Fatalf("url = %q", url)
	}
	// /me (which reads user_cache) shows the new one, not the user-service one.
	if got := meAvatar(t, e, 3); got != url || got == before {
		t.Fatalf("me avatar = %q, want %q", got, url)
	}

	// Anyone signed in can fetch it; it is a 256x256 JPEG whatever was sent.
	get := e.do(5, "GET", "/users/3/avatar", nil, "")
	if get.Code != 200 || get.Header().Get("Content-Type") != "image/jpeg" || get.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("get = %d %v", get.Code, get.Header())
	}
	img, err := jpeg.Decode(get.Body)
	if err != nil || img.Bounds().Dx() != profile.Side || img.Bounds().Dy() != profile.Side {
		t.Fatalf("served image: %v %v", err, img.Bounds())
	}

	// A second upload replaces the file: one avatar file left on disk.
	e.upload(3, "again.png", pngOf(300, 300))
	files, _ := filepath.Glob(filepath.Join(e.dir, "avatars", "3", "*"))
	if len(files) != 1 {
		t.Fatalf("avatar files = %v, want the newest only", files)
	}

	// Removing it brings the user-service picture back and frees the file.
	del := e.do(3, "DELETE", "/me/avatar", nil, "")
	if del.Code != 200 || meAvatar(t, e, 3) != before {
		t.Fatalf("delete = %d %s; me = %q want %q", del.Code, del.Body, meAvatar(t, e, 3), before)
	}
	if files, _ := filepath.Glob(filepath.Join(e.dir, "avatars", "3", "*")); len(files) != 0 {
		t.Fatalf("files left = %v", files)
	}
	if rec := e.do(5, "GET", "/users/3/avatar", nil, ""); rec.Code != 404 {
		t.Fatalf("after delete = %d", rec.Code)
	}
	if rec := e.do(3, "DELETE", "/me/avatar", nil, ""); rec.Code != 404 {
		t.Fatalf("second delete = %d", rec.Code)
	}
}

func TestAvatar_RejectsWhatIsNotASmallImage(t *testing.T) {
	e := newEnv(t)
	gif := []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")
	for _, c := range []struct {
		name    string
		content []byte
		want    string
	}{
		{"empty", nil, "required"},
		{"html renamed png", []byte("<script>alert(1)</script>"), "unsupported_type"},
		{"gif", gif, "unsupported_type"},
		{"over 5 MB", bytes.Repeat([]byte{0xFF}, profile.MaxUpload+1), "too_large"},
	} {
		rec, body := e.upload(3, "x.png", c.content)
		fields, _ := body["fields"].(map[string]any)
		if rec.Code != 422 || fields["file"] != c.want {
			t.Errorf("%s: %d %s, want 422 file=%s", c.name, rec.Code, rec.Body, c.want)
		}
	}
	if rec := e.do(5, "GET", "/users/3/avatar", nil, ""); rec.Code != 404 {
		t.Fatalf("a refused upload left an avatar: %d", rec.Code)
	}
	if entries, _ := os.ReadDir(filepath.Join(e.dir, "avatars")); len(entries) != 0 {
		t.Fatalf("a refused upload left files: %v", entries)
	}
}

func TestAvatar_TooManyPixelsIsRefusedBeforeDecoding(t *testing.T) {
	e := newEnv(t)
	// A PNG header claiming 10000x10000 (100 MP): refused from the header alone.
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, 10000, 10000)))
	rec, body := e.upload(3, "big.png", b.Bytes())
	fields, _ := body["fields"].(map[string]any)
	if rec.Code != 422 || fields["file"] != "too_large" {
		t.Fatalf("huge = %d %s", rec.Code, rec.Body)
	}
}

func TestAvatar_IndexLoadsFromTheStore(t *testing.T) {
	st := memory.New(time.Now)
	blobs, _ := blob.NewLocal(t.TempDir())
	raw := users.NewStub()
	svc := profile.New(st, blobs, raw, profile.NewIndex(), time.Now)
	url, err := svc.SetAvatar(context.Background(), 4, bytes.NewReader(pngOf(64, 64)))
	if err != nil {
		t.Fatal(err)
	}
	// A fresh process: a new index, loaded from what the store holds.
	idx := profile.NewIndex()
	if err := idx.Load(context.Background(), st); err != nil {
		t.Fatal(err)
	}
	got, _ := idx.Wrap(raw).Get(context.Background(), []int64{4, 5})
	if got[0].AvatarURL != url || got[1].AvatarURL == url {
		t.Fatalf("wrapped = %+v, want user 4 at %q", got, url)
	}
}
