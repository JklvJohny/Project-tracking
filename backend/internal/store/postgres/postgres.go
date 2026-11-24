// Package postgres is the PostgreSQL implementation of store.Store. Every repo
// method does what its "SQL:" line in internal/store/repos.go says; the memory
// store is the behaviour reference, and the same service tests run on both.
package postgres

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"tracking-service/internal/clock"
	"tracking-service/internal/store"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store implements store.Store over a connection pool.
type Store struct {
	pool *pgxpool.Pool
	now  clock.Clock
}

var _ store.Store = (*Store)(nil)

// Open connects to url (postgres://user:pass@host:port/db) and checks the
// connection. The role's search_path must lead to the tracking schema
// (db/bootstrap.sql sets it).
func Open(ctx context.Context, url string, now clock.Clock) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	cfg.AfterConnect = func(_ context.Context, c *pgx.Conn) error {
		// Timestamps come back in UTC whatever the session time zone (the
		// role's is Asia/Bangkok), so the API's "...Z" promise holds.
		c.TypeMap().RegisterType(&pgtype.Type{
			Name: "timestamptz", OID: pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC},
		})
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	return &Store{pool: pool, now: now}, nil
}

// Close releases every connection.
func (s *Store) Close() { s.pool.Close() }

// Migrate brings the schema up to the newest migration. goose keeps its
// version table (goose_db_version) in the tracking schema and takes an
// advisory lock, so two instances starting at once do not both migrate.
func (s *Store) Migrate(ctx context.Context) error {
	db := stdlib.OpenDBFromPool(s.pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, mustSub(migrations, "migrations"))
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}

// View runs fn in a read-only snapshot: one request sees one state of the data
// across all its queries.
func (s *Store) View(ctx context.Context, fn func(store.Repos) error) error {
	return s.run(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, fn)
}

// Update runs fn in one transaction: committed when fn returns nil, rolled
// back otherwise. Read committed plus the row locks the services take (board,
// then list, then card) is what keeps concurrent writers apart.
func (s *Store) Update(ctx context.Context, fn func(store.Repos) error) error {
	return s.run(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, fn)
}

func (s *Store) run(ctx context.Context, opts pgx.TxOptions, fn func(store.Repos) error) error {
	tx, err := s.pool.BeginTx(ctx, opts)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck // a no-op after Commit
	if err := fn(s.repos(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) repos(tx pgx.Tx) store.Repos {
	q := db{tx: tx, now: s.now}
	return store.Repos{
		Projects:  projectRepo{q},
		Members:   memberRepo{q},
		Boards:    boardRepo{q},
		Lists:     listRepo{q},
		Cards:     cardRepo{q},
		Labels:    labelRepo{q},
		Checklist: checklistRepo{q},
		Comments:  commentRepo{q},
		UserRoles: userRoleRepo{q},
		Users:     userRepo{q},
		Activity:  activityRepo{q},
		Documents: documentRepo{q},
		Templates: templateRepo{q},
		Dashboard: dashboardRepo{q},
		Team:      teamRepo{q},
		Avatars:   avatarRepo{q},
		Shares:    shareRepo{q},
	}
}

// db is what every repo holds: the unit of work's transaction.
type db struct {
	tx  pgx.Tx
	now clock.Clock
}

// one maps "no row" to store.ErrNotFound.
func one(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return store.ErrNotFound
	}
	return dup(err)
}

// dup maps a unique violation to store.ErrDuplicate. The transaction is
// aborted after it, so the caller must return the error, not carry on.
func dup(err error) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return store.ErrDuplicate
	}
	return err
}

// exec runs a write and reports how many rows it touched.
func (q db) exec(ctx context.Context, sql string, args ...any) (int64, error) {
	tag, err := q.tx.Exec(ctx, sql, args...)
	if err != nil {
		return 0, dup(err)
	}
	return tag.RowsAffected(), nil
}

// mustExist is exec for writes to one existing row: 0 rows is ErrNotFound.
func (q db) mustExist(ctx context.Context, sql string, args ...any) error {
	n, err := q.exec(ctx, sql, args...)
	if err == nil && n == 0 {
		return store.ErrNotFound
	}
	return err
}

// ids reads a single bigint column.
func (q db) ids(ctx context.Context, sql string, args ...any) ([]int64, error) {
	rows, _ := q.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if out == nil {
		out = []int64{}
	}
	return out, err
}

// Dates travel as text ("YYYY-MM-DD") both ways: SELECT date_col::text, and
// $n::date on the way in.

func dateArg(d *store.Date) any {
	if d == nil {
		return nil
	}
	return string(*d)
}

func toDate(s *string) *store.Date {
	if s == nil {
		return nil
	}
	d := store.Date(*s)
	return &d
}
