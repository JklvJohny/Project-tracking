package httpx_test

import (
	"io"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"tracking-service/internal/auth"
	"tracking-service/internal/board"
	"tracking-service/internal/card"
	"tracking-service/internal/dashboard"
	"tracking-service/internal/document"
	"tracking-service/internal/events"
	"tracking-service/internal/httpx"
	"tracking-service/internal/profile"
	"tracking-service/internal/project"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/team"
	"tracking-service/internal/users"
)

type noAuth struct{}

func (noAuth) Authenticate(*http.Request) (int64, error) { return 1, nil }

func TestOpenAPI_CoversEveryRoute(t *testing.T) {
	st := memory.New(time.Now)
	up := users.NewStub()
	ev := events.NewLog(slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := httpx.NewRouter(func(r chi.Router) {
		r.Use(auth.Middleware(noAuth{}))
		project.Mount(r, project.New(st, up, ev, time.Now))
		board.Mount(r, board.New(st, ev, time.Now))
		card.Mount(r, card.New(st, up, ev, time.Now))
		document.Mount(r, document.New(st, nil, users.NewStub(), time.Now))
		dashboard.Mount(r, dashboard.New(st, time.Now))
		team.Mount(r, team.New(st, up, time.Now))
		profile.Mount(r, profile.New(st, nil, up, profile.NewIndex(), time.Now))
	})

	got := map[string]bool{}
	for _, rt := range httpx.Routes(h) {
		method, path, _ := strings.Cut(rt, " ")
		got[method+" "+strings.TrimPrefix(path, httpx.BasePath)] = true
	}

	raw, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read spec: %v", err)
	}
	var spec struct {
		Paths map[string]map[string]yaml.Node `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse spec: %v", err)
	}
	methods := map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true}
	want := map[string]bool{}
	for p, item := range spec.Paths {
		for m := range item {
			if methods[m] {
				want[strings.ToUpper(m)+" "+p] = true
			}
		}
	}

	var missing, extra []string
	for k := range got {
		if !want[k] {
			missing = append(missing, k)
		}
	}
	for k := range want {
		if !got[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(got) == 0 {
		t.Fatal("router reported no routes")
	}
	if len(missing) > 0 {
		t.Errorf("routes without an OpenAPI operation:\n  %s", strings.Join(missing, "\n  "))
	}
	if len(extra) > 0 {
		t.Errorf("OpenAPI operations without a route:\n  %s", strings.Join(extra, "\n  "))
	}
}
