package config

import "testing"

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
