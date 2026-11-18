// Package config reads process configuration from the environment.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Env       string
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
	switch strings.ToLower(os.Getenv("SEED_LARGE")) {
	case "1", "true":
		c.SeedLarge = true
	}
	return c, nil
}
