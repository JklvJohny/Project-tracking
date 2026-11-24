// Package storetest gives each test a fresh, empty store. Without
// TRACKING_TEST_DATABASE_URL it is the memory store. With it, it is a new
// PostgreSQL database per test, set up exactly as production is
// (db/bootstrap.sql, then the migrations, connected as tracking_app), so the
// same service tests check both stores.
//
//	TRACKING_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres go test ./...
//
// The URL is a superuser on a server the tests may create and drop databases
// on; never point it at a real one. The tests set tracking_app's password.
package storetest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
	"tracking-service/internal/store/memory"
	"tracking-service/internal/store/postgres"
)

// Store is what tests use besides store.Store: rows no API writes, and the
// activity log to assert on.
type Store interface {
	store.Store
	SeedUserRole(store.UserRole) error
	SeedSkills(userID int64, skills ...string) error
	Activity() []store.ActivityEvent
}

const envURL = "TRACKING_TEST_DATABASE_URL"

// appPassword is set on tracking_app in the test server only.
const appPassword = "tracking-test"

// Postgres reports whether tests run against PostgreSQL.
func Postgres() bool { return os.Getenv(envURL) != "" }

// New returns an empty store for t, removed when t ends.
func New(t testing.TB, now clock.Clock) Store {
	t.Helper()
	admin := os.Getenv(envURL)
	if admin == "" {
		return memory.New(now)
	}
	name := fmt.Sprintf("tt_%d_%d", os.Getpid(), counter.Add(1))
	ctx := context.Background()
	tpl, err := template(ctx, admin)
	if err != nil {
		t.Fatalf("storetest: template: %v", err)
	}
	if err := adminExec(ctx, admin, "postgres", func(c *pgx.Conn) error {
		for try := 0; ; try++ {
			_, err := c.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s TEMPLATE %s`, name, tpl))
			var pe *pgconn.PgError
			// Another test may be copying the template this instant.
			if errors.As(err, &pe) && pe.Code == "55006" && try < 50 {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			if err != nil {
				return err
			}
			// Role settings are per database and do not travel with a template.
			return roleSettings(ctx, c, name)
		}
	}); err != nil {
		t.Fatalf("storetest: create database: %v", err)
	}
	t.Cleanup(func() {
		_ = adminExec(context.Background(), admin, "postgres", func(c *pgx.Conn) error {
			_, err := c.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, name))
			return err
		})
	})
	st, err := postgres.Open(ctx, appURL(admin, name), now)
	if err != nil {
		t.Fatalf("storetest: open: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

var (
	counter atomic.Int64
	tplOnce sync.Once
	tplName string
	tplErr  error
)

// template builds, once per server and schema version, a database that has
// had bootstrap.sql and every migration applied; each test copies it, which
// is much faster than migrating from scratch. Its name carries a hash of the
// SQL, so a changed migration gets a new template and the old one is dropped.
func template(ctx context.Context, admin string) (string, error) {
	tplOnce.Do(func() { tplName, tplErr = buildTemplate(ctx, admin) })
	return tplName, tplErr
}

func buildTemplate(ctx context.Context, admin string) (string, error) {
	_, file, _, _ := runtime.Caller(0)
	backend := filepath.Join(filepath.Dir(file), "..", "..", "..")
	bootstrap, err := os.ReadFile(filepath.Join(backend, "db", "bootstrap.sql"))
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write(bootstrap)
	if err := filepath.WalkDir(filepath.Join(backend, "internal", "store", "postgres", "migrations"), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(p)
		h.Write(b)
		return err
	}); err != nil {
		return "", err
	}
	name := "tt_tpl_" + hex.EncodeToString(h.Sum(nil))[:12]

	err = adminExec(ctx, admin, "postgres", func(c *pgx.Conn) error {
		// One builder at a time across test processes (go test runs packages in parallel).
		if _, err := c.Exec(ctx, `SELECT pg_advisory_lock(424242)`); err != nil {
			return err
		}
		defer c.Exec(context.Background(), `SELECT pg_advisory_unlock(424242)`) //nolint:errcheck
		var exists bool
		if err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return nil
		}
		old, _ := c.Query(ctx, `SELECT datname FROM pg_database WHERE datname LIKE 'tt\_tpl\_%'`)
		stale, err := pgx.CollectRows(old, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, s := range stale {
			if _, err := c.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, s)); err != nil {
				return err
			}
		}
		building := name + "_wip"
		if _, err := c.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, building)); err != nil {
			return err
		}
		if _, err := c.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s`, building)); err != nil {
			return err
		}
		if err := adminExec(ctx, admin, building, func(b *pgx.Conn) error {
			if _, err := b.Exec(ctx, string(bootstrap)); err != nil {
				return err
			}
			_, err := b.Exec(ctx, fmt.Sprintf(`ALTER ROLE tracking_app PASSWORD '%s'`, appPassword))
			return err
		}); err != nil {
			return err
		}
		st, err := postgres.Open(ctx, appURL(admin, building), clock.UTC)
		if err != nil {
			return err
		}
		err = st.Migrate(ctx)
		st.Close()
		if err != nil {
			return err
		}
		_, err = c.Exec(ctx, fmt.Sprintf(`ALTER DATABASE %s RENAME TO %s`, building, name))
		return err
	})
	return name, err
}

func roleSettings(ctx context.Context, c *pgx.Conn, db string) error {
	for _, q := range []string{
		`ALTER ROLE tracking_app IN DATABASE %s SET timezone = 'Asia/Bangkok'`,
		`ALTER ROLE tracking_app IN DATABASE %s SET search_path = tracking`,
	} {
		if _, err := c.Exec(ctx, fmt.Sprintf(q, db)); err != nil {
			return err
		}
	}
	return nil
}

// adminExec runs fn on a superuser connection to database db.
func adminExec(ctx context.Context, admin, db string, fn func(*pgx.Conn) error) error {
	u, err := url.Parse(admin)
	if err != nil {
		return err
	}
	u.Path = "/" + db
	c, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return err
	}
	defer c.Close(context.Background())
	return fn(c)
}

// appURL is the admin URL with tracking_app's credentials and database db.
func appURL(admin, db string) string {
	u, _ := url.Parse(admin)
	u.User = url.UserPassword("tracking_app", appPassword)
	u.Path = "/" + db
	q := u.Query()
	q.Del("search_path")
	u.RawQuery = q.Encode()
	return strings.TrimSuffix(u.String(), "?")
}
