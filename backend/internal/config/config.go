// Package config reads process configuration from the environment.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Env string
	// Host is the address to listen on. Locally it defaults to 127.0.0.1: the
	// local build trusts an X-User-ID header, so it must not be reachable from
	// the rest of the network. Elsewhere it defaults to every interface.
	Host      string
	Port      string
	SeedLarge bool
	UploadDir string
	// DatabaseURL selects PostgreSQL (postgres://tracking_app:...@host:5432/tracking).
	// Empty keeps the in-memory store, which forgets everything on restart:
	// allowed only locally.
	DatabaseURL string
}

// LoadDotEnv sets KEY=VALUE lines from path for every key the environment
// does not already have, so a developer keeps secrets such as DATABASE_URL in
// a git-ignored .env.local instead of the committed air.env. A missing file is
// not an error. Blank lines and lines starting with # are skipped.
func LoadDotEnv(path string) error {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if line == "" || strings.HasPrefix(line, "#") || !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if _, set := os.LookupEnv(k); !set {
			if err := os.Setenv(k, strings.Trim(strings.TrimSpace(v), `"'`)); err != nil {
				return err
			}
		}
	}
	return nil
}

func Load() (Config, error) {
	c := Config{Env: os.Getenv("ENV"), Port: os.Getenv("PORT")}
	if c.Env == "" {
		return Config{}, errors.New("ENV is required")
	}
	if c.UploadDir = os.Getenv("UPLOAD_DIR"); c.UploadDir == "" {
		c.UploadDir = "./uploads"
	}
	if c.Port == "" {
		c.Port = "8081"
	}
	if n, err := strconv.Atoi(c.Port); err != nil || n < 1 || n > 65535 {
		return Config{}, errors.New("PORT must be a number from 1 to 65535")
	}
	c.Host = os.Getenv("HOST")
	if c.Host == "" && c.Env == "local" {
		c.Host = "127.0.0.1"
	}
	c.DatabaseURL = os.Getenv("DATABASE_URL")
	if c.DatabaseURL == "" && c.Env != "local" {
		return Config{}, errors.New("DATABASE_URL is required outside ENV=local")
	}
	switch strings.ToLower(os.Getenv("SEED_LARGE")) {
	case "1", "true":
		c.SeedLarge = true
	}
	return c, nil
}
