package postgres

import (
	"context"
	"encoding/json"
	"io/fs"
	"time"

	"github.com/jackc/pgx/v5"

	"tracking-service/internal/store"
)

func mustSub(f fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		panic(err)
	}
	return sub
}

// ---- projects --------------------------------------------------------------

type projectRepo struct{ db }

const projectCols = `id, name, description, owner_id, status, start_date::text, end_date::text,
	created_by, created_at, updated_at, archived_at`

func scanProject(row pgx.CollectableRow) (store.Project, error) {
	var p store.Project
	var start, end *string
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.Status, &start, &end,
		&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt)
	p.StartDate, p.EndDate = toDate(start), toDate(end)
	return p, err
}

func (r projectRepo) list(ctx context.Context, sql string, args ...any) ([]store.Project, error) {
	rows, _ := r.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, scanProject)
	if out == nil {
		out = []store.Project{}
	}
	return out, err
}

func (r projectRepo) Create(ctx context.Context, p store.Project) (store.Project, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO projects (name, description, owner_id, status, start_date, end_date,
		created_by, created_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10) RETURNING id`,
		p.Name, p.Description, p.OwnerID, p.Status, dateArg(p.StartDate), dateArg(p.EndDate),
		p.CreatedBy, p.CreatedAt, p.UpdatedAt, p.ArchivedAt).Scan(&p.ID)
	return p, dup(err)
}

func (r projectRepo) Get(ctx context.Context, id int64) (store.Project, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+projectCols+` FROM projects WHERE id = $1`, id)
	p, err := pgx.CollectExactlyOneRow(rows, scanProject)
	return p, one(err)
}

func (r projectRepo) Save(ctx context.Context, p store.Project) error {
	return r.mustExist(ctx, `UPDATE projects SET name = $2, description = $3, owner_id = $4, status = $5,
		start_date = $6::date, end_date = $7::date, created_by = $8, created_at = $9, updated_at = $10,
		archived_at = $11 WHERE id = $1`,
		p.ID, p.Name, p.Description, p.OwnerID, p.Status, dateArg(p.StartDate), dateArg(p.EndDate),
		p.CreatedBy, p.CreatedAt, p.UpdatedAt, p.ArchivedAt)
}

func (r projectRepo) All(ctx context.Context) ([]store.Project, error) {
	return r.list(ctx, `SELECT `+projectCols+` FROM projects ORDER BY id`)
}

func (r projectRepo) ByMember(ctx context.Context, userID int64) ([]store.Project, error) {
	return r.list(ctx, `SELECT `+projectCols+` FROM projects p
		WHERE EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)
		ORDER BY id`, userID)
}

func (r projectRepo) NameTaken(ctx context.Context, name string, exceptID int64) (bool, error) {
	var taken bool
	err := r.tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM projects WHERE lower(name) = lower($1)
		AND archived_at IS NULL AND id <> $2)`, name, exceptID).Scan(&taken)
	return taken, err
}

func (r projectRepo) Summaries(ctx context.Context, projectIDs []int64) (map[int64]store.ProjectSummary, error) {
	out := make(map[int64]store.ProjectSummary, len(projectIDs))
	for _, id := range projectIDs {
		out[id] = store.ProjectSummary{Members: []store.Member{}}
	}
	ms, err := memberRepo(r).list(ctx, `SELECT `+memberCols+` FROM project_members WHERE project_id = ANY($1)`, projectIDs)
	if err != nil {
		return nil, err
	}
	for _, m := range ms {
		s := out[m.ProjectID]
		s.Members = append(s.Members, m)
		out[m.ProjectID] = s
	}
	rows, _ := r.tx.Query(ctx, `SELECT b.project_id, count(*), count(c.completed_at)
		FROM boards b JOIN lists l ON l.board_id = b.id AND l.archived_at IS NULL
		JOIN cards c ON c.list_id = l.id AND c.archived_at IS NULL
		WHERE b.project_id = ANY($1) GROUP BY b.project_id`, projectIDs)
	var pid int64
	var total, done int
	if _, err := pgx.ForEachRow(rows, []any{&pid, &total, &done}, func() error {
		s := out[pid]
		s.CardsTotal, s.CardsDone = total, done
		out[pid] = s
		return nil
	}); err != nil {
		return nil, err
	}
	rows, _ = r.tx.Query(ctx, `SELECT project_id, count(*) FROM documents
		WHERE project_id = ANY($1) AND deleted_at IS NULL GROUP BY project_id`, projectIDs)
	var docs int
	if _, err := pgx.ForEachRow(rows, []any{&pid, &docs}, func() error {
		s := out[pid]
		s.Documents = docs
		out[pid] = s
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// ---- members ---------------------------------------------------------------

type memberRepo struct{ db }

const memberCols = `project_id, user_id, role, added_at`

func scanMember(row pgx.CollectableRow) (store.Member, error) {
	var m store.Member
	err := row.Scan(&m.ProjectID, &m.UserID, &m.Role, &m.AddedAt)
	return m, err
}

func (r memberRepo) list(ctx context.Context, sql string, args ...any) ([]store.Member, error) {
	rows, _ := r.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, scanMember)
	if out == nil {
		out = []store.Member{}
	}
	return out, err
}

func (r memberRepo) Get(ctx context.Context, projectID, userID int64) (store.Member, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+memberCols+` FROM project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID)
	m, err := pgx.CollectExactlyOneRow(rows, scanMember)
	return m, one(err)
}

func (r memberRepo) List(ctx context.Context, projectID int64) ([]store.Member, error) {
	return r.list(ctx, `SELECT `+memberCols+` FROM project_members WHERE project_id = $1 ORDER BY added_at, user_id`, projectID)
}

func (r memberRepo) Put(ctx context.Context, m store.Member) error {
	_, err := r.exec(ctx, `INSERT INTO project_members (project_id, user_id, role, added_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, m.ProjectID, m.UserID, m.Role, m.AddedAt)
	return err
}

func (r memberRepo) Delete(ctx context.Context, projectID, userID int64) error {
	return r.mustExist(ctx, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID)
}

func (r memberRepo) CountPM(ctx context.Context, projectID int64) (int, error) {
	var n int
	err := r.tx.QueryRow(ctx, `SELECT count(*) FROM project_members WHERE project_id = $1 AND role = 'pm'`, projectID).Scan(&n)
	return n, err
}

// ---- people ----------------------------------------------------------------

type userRoleRepo struct{ db }

func (r userRoleRepo) Get(ctx context.Context, userID int64) (*store.UserRole, error) {
	var ur store.UserRole
	err := r.tx.QueryRow(ctx, `SELECT user_id, role, granted_at, granted_by FROM user_roles WHERE user_id = $1`, userID).
		Scan(&ur.UserID, &ur.Role, &ur.GrantedAt, &ur.GrantedBy)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ur, nil
}

type userRepo struct{ db }

func scanUser(row pgx.CollectableRow) (store.CachedUser, error) {
	var u store.CachedUser
	err := row.Scan(&u.UserID, &u.DisplayName, &u.Handle, &u.AvatarURL, &u.SyncedAt)
	return u, err
}

func (r userRepo) Upsert(ctx context.Context, us []store.CachedUser) error {
	b := &pgx.Batch{}
	for _, u := range us {
		if u.SyncedAt.IsZero() {
			u.SyncedAt = r.now()
		}
		b.Queue(`INSERT INTO user_cache (user_id, display_name, handle, avatar_url, synced_at) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, handle = EXCLUDED.handle,
			avatar_url = EXCLUDED.avatar_url, synced_at = EXCLUDED.synced_at`,
			u.UserID, u.DisplayName, u.Handle, u.AvatarURL, u.SyncedAt)
	}
	return r.tx.SendBatch(ctx, b).Close()
}

func (r userRepo) Get(ctx context.Context, ids []int64) ([]store.CachedUser, error) {
	rows, _ := r.tx.Query(ctx, `SELECT c.user_id, c.display_name, c.handle, c.avatar_url, c.synced_at
		FROM unnest($1::bigint[]) WITH ORDINALITY AS w(id, ord) JOIN user_cache c ON c.user_id = w.id
		ORDER BY w.ord`, ids)
	out, err := pgx.CollectRows(rows, scanUser)
	if out == nil {
		out = []store.CachedUser{}
	}
	return out, err
}

func (r userRepo) Stale(ctx context.Context, before time.Time, limit int) ([]int64, error) {
	return r.ids(ctx, `SELECT user_id FROM user_cache WHERE synced_at < $1 ORDER BY synced_at, user_id LIMIT $2`, before, limit)
}

type activityRepo struct{ db }

func (r activityRepo) Append(ctx context.Context, e store.ActivityEvent) error {
	if e.CreatedAt.IsZero() {
		e.CreatedAt = r.now()
	}
	payload := e.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	_, err := r.exec(ctx, `INSERT INTO activity_events (project_id, card_id, actor_id, type, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, e.ProjectID, e.CardID, e.ActorID, e.Type, string(payload), e.CreatedAt)
	return err
}

type avatarRepo struct{ db }

func scanAvatar(row pgx.CollectableRow) (store.UserAvatar, error) {
	var a store.UserAvatar
	err := row.Scan(&a.UserID, &a.StorageKey, &a.UpdatedAt)
	return a, err
}

func (r avatarRepo) Get(ctx context.Context, userID int64) (store.UserAvatar, error) {
	rows, _ := r.tx.Query(ctx, `SELECT user_id, storage_key, updated_at FROM user_avatars WHERE user_id = $1`, userID)
	a, err := pgx.CollectExactlyOneRow(rows, scanAvatar)
	return a, one(err)
}

func (r avatarRepo) All(ctx context.Context) ([]store.UserAvatar, error) {
	rows, _ := r.tx.Query(ctx, `SELECT user_id, storage_key, updated_at FROM user_avatars ORDER BY user_id`)
	out, err := pgx.CollectRows(rows, scanAvatar)
	if out == nil {
		out = []store.UserAvatar{}
	}
	return out, err
}

func (r avatarRepo) Set(ctx context.Context, a store.UserAvatar) error {
	_, err := r.exec(ctx, `INSERT INTO user_avatars (user_id, storage_key, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, updated_at = EXCLUDED.updated_at`,
		a.UserID, a.StorageKey, a.UpdatedAt)
	return err
}

func (r avatarRepo) Delete(ctx context.Context, userID int64) error {
	return r.mustExist(ctx, `DELETE FROM user_avatars WHERE user_id = $1`, userID)
}

// ---- report folder shares --------------------------------------------------

type shareRepo struct{ db }

func scanShare(row pgx.CollectableRow) (store.FolderShare, error) {
	var s store.FolderShare
	err := row.Scan(&s.ProjectID, &s.UserID, &s.SharedBy, &s.CreatedAt)
	return s, err
}

func (r shareRepo) list(ctx context.Context, sql string, args ...any) ([]store.FolderShare, error) {
	rows, _ := r.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, scanShare)
	if out == nil {
		out = []store.FolderShare{}
	}
	return out, err
}

const shareCols = `project_id, user_id, shared_by, created_at`

func (r shareRepo) Get(ctx context.Context, projectID, userID int64) (store.FolderShare, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+shareCols+` FROM folder_shares WHERE project_id = $1 AND user_id = $2`, projectID, userID)
	s, err := pgx.CollectExactlyOneRow(rows, scanShare)
	return s, one(err)
}

func (r shareRepo) ByProject(ctx context.Context, projectID int64) ([]store.FolderShare, error) {
	return r.list(ctx, `SELECT `+shareCols+` FROM folder_shares WHERE project_id = $1 ORDER BY created_at, user_id`, projectID)
}

func (r shareRepo) ByUser(ctx context.Context, userID int64) ([]store.FolderShare, error) {
	return r.list(ctx, `SELECT `+shareCols+` FROM folder_shares WHERE user_id = $1 ORDER BY project_id`, userID)
}

func (r shareRepo) Create(ctx context.Context, s store.FolderShare) error {
	_, err := r.exec(ctx, `INSERT INTO folder_shares (project_id, user_id, shared_by, created_at) VALUES ($1, $2, $3, $4)`,
		s.ProjectID, s.UserID, s.SharedBy, s.CreatedAt)
	return err
}

func (r shareRepo) Delete(ctx context.Context, projectID, userID int64) error {
	return r.mustExist(ctx, `DELETE FROM folder_shares WHERE project_id = $1 AND user_id = $2`, projectID, userID)
}
