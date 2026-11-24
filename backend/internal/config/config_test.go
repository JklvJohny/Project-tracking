package config

import (
	"os"
	"path/filepath"
	"testing"
)

// The local build trusts an X-User-ID header, so locally the service listens
// on this machine only unless HOST says otherwise.
func TestLoad_LocalListensOnLoopbackOnly(t *testing.T) {
	for _, c := range []struct{ env, host, want string }{
		{"local", "", "127.0.0.1"},
		{"local", "0.0.0.0", "0.0.0.0"},
		{"production", "", ""},
	} {
		t.Setenv("ENV", c.env)
		t.Setenv("HOST", c.host)
		t.Setenv("PORT", "")
		t.Setenv("DATABASE_URL", "postgres://x@db/tracking")
		got, err := Load()
		if err != nil || got.Host != c.want || got.Port != "8081" {
			t.Errorf("ENV=%s HOST=%q: host %q port %q err %v, want host %q", c.env, c.host, got.Host, got.Port, err, c.want)
		}
	}
	t.Setenv("PORT", "80a")
	if _, err := Load(); err == nil {
		t.Error("a non-numeric PORT was accepted")
	}
}

// Outside local there is no in-memory fallback: losing every row on restart
// is never acceptable there.
func TestLoad_DatabaseURLRequiredOutsideLocal(t *testing.T) {
	t.Setenv("ENV", "production")
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("production started without DATABASE_URL")
	}
	t.Setenv("ENV", "local")
	if c, err := Load(); err != nil || c.DatabaseURL != "" {
		t.Fatalf("local without DATABASE_URL: %+v %v", c, err)
	}
}

// .env.local fills only what the environment lacks, so a shell variable wins.
func TestLoadDotEnv_FillsOnlyUnsetKeys(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env.local")
	if err := os.WriteFile(p, []byte("# local\r\nDATABASE_URL=\"postgres://a@b/c\"\r\n\r\nPORT=9999\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PORT", "8081")
	t.Setenv("DATABASE_URL", "")
	os.Unsetenv("DATABASE_URL")
	if err := LoadDotEnv(p); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("DATABASE_URL"); got != "postgres://a@b/c" {
		t.Errorf("DATABASE_URL = %q", got)
	}
	if got := os.Getenv("PORT"); got != "8081" {
		t.Errorf("PORT = %q, the environment must win", got)
	}
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Errorf("missing file: %v", err)
	}
}
