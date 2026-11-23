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
	switch strings.ToLower(os.Getenv("SEED_LARGE")) {
	case "1", "true":
		c.SeedLarge = true
	}
	return c, nil
}
