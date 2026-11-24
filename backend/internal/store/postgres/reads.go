package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"tracking-service/internal/store"
)

// ---- documents -------------------------------------------------------------

type documentRepo struct{ db }

const documentCols = `id, project_id, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, deleted_at`

func scanDocument(row pgx.CollectableRow) (store.Document, error) {
	var d store.Document
	err := row.Scan(&d.ID, &d.ProjectID, &d.StorageKey, &d.Filename, &d.MimeType, &d.SizeBytes, &d.UploadedBy, &d.CreatedAt, &d.DeletedAt)
	return d, err
}

func (r documentRepo) Create(ctx context.Context, d store.Document) (store.Document, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO documents (project_id, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, deleted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		d.ProjectID, d.StorageKey, d.Filename, d.MimeType, d.SizeBytes, d.UploadedBy, d.CreatedAt, d.DeletedAt).Scan(&d.ID)
	return d, dup(err)
}

func (r documentRepo) Get(ctx context.Context, id int64) (store.Document, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+documentCols+` FROM documents WHERE id = $1`, id)
	d, err := pgx.CollectExactlyOneRow(rows, scanDocument)
	return d, one(err)
}

func (r documentRepo) SetDeleted(ctx context.Context, id int64, at *time.Time) (bool, error) {
	n, err := r.exec(ctx, `UPDATE documents SET deleted_at = $2 WHERE id = $1
		AND (deleted_at IS NULL) = ($2::timestamptz IS NOT NULL)`, id, at)
	if err != nil || n == 1 {
		return n == 1, err
	}
	var ok bool
	if err := r.tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1)`, id).Scan(&ok); err != nil {
		return false, err
	}
	if !ok {
		return false, store.ErrNotFound
	}
	return false, nil
}

func (r documentRepo) ByProject(ctx context.Context, projectID int64) ([]store.Document, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+documentCols+` FROM documents WHERE project_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC, id DESC`, projectID)
	out, err := pgx.CollectRows(rows, scanDocument)
	if out == nil {
		out = []store.Document{}
	}
	return out, err
}

// ---- report templates ------------------------------------------------------

type templateRepo struct{ db }

const templateCols = `id, category, name, description, storage_key, filename, mime_type, size_bytes, uploaded_by,
	created_at, updated_at, deleted_at`

func scanTemplate(row pgx.CollectableRow) (store.ReportTemplate, error) {
	var t store.ReportTemplate
	err := row.Scan(&t.ID, &t.Category, &t.Name, &t.Description, &t.StorageKey, &t.Filename, &t.MimeType, &t.SizeBytes,
		&t.UploadedBy, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt)
	return t, err
}

func (r templateRepo) Create(ctx context.Context, t store.ReportTemplate) (store.ReportTemplate, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO report_templates (category, name, description, storage_key, filename, mime_type,
		size_bytes, uploaded_by, created_at, updated_at, deleted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		t.Category, t.Name, t.Description, t.StorageKey, t.Filename, t.MimeType, t.SizeBytes, t.UploadedBy,
		t.CreatedAt, t.UpdatedAt, t.DeletedAt).Scan(&t.ID)
	return t, dup(err)
}

func (r templateRepo) Get(ctx context.Context, id int64) (store.ReportTemplate, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+templateCols+` FROM report_templates WHERE id = $1`, id)
	t, err := pgx.CollectExactlyOneRow(rows, scanTemplate)
	return t, one(err)
}

func (r templateRepo) SaveDetails(ctx context.Context, t store.ReportTemplate) error {
	return r.mustExist(ctx, `UPDATE report_templates SET category = $2, name = $3, description = $4, updated_at = $5
		WHERE id = $1`, t.ID, t.Category, t.Name, t.Description, t.UpdatedAt)
}

func (r templateRepo) SetDeleted(ctx context.Context, id int64, at *time.Time) error {
	return r.mustExist(ctx, `UPDATE report_templates SET deleted_at = $2 WHERE id = $1`, id, at)
}

// List sorts with COLLATE "C" so the order is the same bytewise one as the
// memory store whatever the database's locale.
func (r templateRepo) List(ctx context.Context) ([]store.ReportTemplate, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+templateCols+` FROM report_templates WHERE deleted_at IS NULL
		ORDER BY lower(category) COLLATE "C", lower(name) COLLATE "C", id`)
	out, err := pgx.CollectRows(rows, scanTemplate)
	if out == nil {
		out = []store.ReportTemplate{}
	}
	return out, err
}

// ---- dashboard -------------------------------------------------------------

type dashboardRepo struct{ db }

func scanDashRow(row pgx.CollectableRow, extra ...any) (store.DashboardRow, error) {
	var d store.DashboardRow
	var start, due *string
	err := row.Scan(append([]any{&d.CardID, &d.ProjectID, &d.ProjectName, &d.ListName, &d.Title, &d.Priority,
		&start, &due, &d.CompletedAt, &d.AssigneeIDs}, extra...)...)
	d.StartDate, d.DueDate = toDate(start), toDate(due)
	return d, err
}

func (r dashboardRepo) Rows(ctx context.Context, projectIDs []int64) ([]store.DashboardRow, error) {
	rows, _ := r.tx.Query(ctx, `SELECT c.id, p.id, p.name, l.name, c.title, c.priority, c.start_date::text,
		c.due_date::text, c.completed_at,
		COALESCE((SELECT array_agg(user_id ORDER BY user_id) FROM card_assignees WHERE card_id = c.id), '{}')
		FROM cards c JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL
		JOIN boards b ON b.id = l.board_id
		JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
		WHERE p.id = ANY($1) AND c.archived_at IS NULL ORDER BY p.id, c.id`, projectIDs)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.DashboardRow, error) { return scanDashRow(row) })
	if out == nil {
		out = []store.DashboardRow{}
	}
	return out, err
}

func (r dashboardRepo) AssignedTo(ctx context.Context, userID int64, projectIDs []int64) ([]store.TaskRow, error) {
	rows, _ := r.tx.Query(ctx, `SELECT c.id, p.id, p.name, l.name, c.title, c.priority, c.start_date::text,
		c.due_date::text, c.completed_at,
		(SELECT array_agg(user_id ORDER BY user_id) FROM card_assignees WHERE card_id = c.id),
		(SELECT count(*) FROM checklist_items WHERE card_id = c.id),
		(SELECT count(*) FROM checklist_items WHERE card_id = c.id AND is_done)
		FROM card_assignees me JOIN cards c ON c.id = me.card_id
		JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL
		JOIN boards b ON b.id = l.board_id
		JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
		WHERE me.user_id = $1 AND p.id = ANY($2) AND c.archived_at IS NULL AND c.completed_at IS NULL
		ORDER BY c.due_date NULLS LAST, c.id`, userID, projectIDs)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.TaskRow, error) {
		var t store.TaskRow
		var err error
		t.DashboardRow, err = scanDashRow(row, &t.ChecklistTotal, &t.ChecklistDone)
		return t, err
	})
	if out == nil {
		out = []store.TaskRow{}
	}
	return out, err
}

// ---- team ------------------------------------------------------------------

type teamRepo struct{ db }

func (r teamRepo) Skills(ctx context.Context) (map[int64][]string, error) {
	rows, _ := r.tx.Query(ctx, `SELECT user_id, array_agg(skill ORDER BY position) FROM user_skills GROUP BY user_id`)
	out := map[int64][]string{}
	var id int64
	var skills []string
	_, err := pgx.ForEachRow(rows, []any{&id, &skills}, func() error {
		out[id] = skills
		skills = nil
		return nil
	})
	return out, err
}

func (r teamRepo) SetSkills(ctx context.Context, userID int64, skills []string) error {
	if _, err := r.exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('user_skills:' || $1::bigint, 0))`, userID); err != nil {
		return err
	}
	if _, err := r.exec(ctx, `DELETE FROM user_skills WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if len(skills) == 0 {
		return nil
	}
	_, err := r.exec(ctx, `INSERT INTO user_skills (user_id, skill, position)
		SELECT $1, s, ord FROM unnest($2::text[]) WITH ORDINALITY AS t(s, ord)`, userID, skills)
	return err
}

func (r teamRepo) Workload(ctx context.Context, today, soon store.Date) (map[int64]store.Workload, error) {
	rows, _ := r.tx.Query(ctx, `SELECT a.user_id, count(*),
		count(*) FILTER (WHERE c.due_date < $1::date),
		count(*) FILTER (WHERE c.due_date >= $1::date AND c.due_date < $2::date)
		FROM card_assignees a
		JOIN cards c ON c.id = a.card_id AND c.archived_at IS NULL AND c.completed_at IS NULL
		JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL
		JOIN boards b ON b.id = l.board_id
		JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
		GROUP BY a.user_id`, string(today), string(soon))
	out := map[int64]store.Workload{}
	var id int64
	var w store.Workload
	_, err := pgx.ForEachRow(rows, []any{&id, &w.Open, &w.Overdue, &w.DueSoon}, func() error {
		out[id] = w
		return nil
	})
	return out, err
}

func scanCatalog(row pgx.CollectableRow) (store.CatalogSkill, error) {
	var s store.CatalogSkill
	err := row.Scan(&s.Name, &s.CategoryID, &s.CreatedBy, &s.CreatedAt)
	return s, err
}

func (r teamRepo) Catalog(ctx context.Context) ([]store.CatalogSkill, error) {
	rows, _ := r.tx.Query(ctx, `SELECT name, category_id, created_by, created_at FROM skill_catalog
		ORDER BY lower(name) COLLATE "C", name COLLATE "C"`)
	out, err := pgx.CollectRows(rows, scanCatalog)
	if out == nil {
		out = []store.CatalogSkill{}
	}
	return out, err
}

func (r teamRepo) AddToCatalog(ctx context.Context, s store.CatalogSkill) (bool, error) {
	n, err := r.exec(ctx, `INSERT INTO skill_catalog (name, category_id, created_by, created_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT ((lower(name))) DO NOTHING`, s.Name, s.CategoryID, s.CreatedBy, s.CreatedAt)
	return n == 1, err
}

func (r teamRepo) SetSkillCategory(ctx context.Context, s store.CatalogSkill) error {
	_, err := r.exec(ctx, `INSERT INTO skill_catalog (name, category_id, created_by, created_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT ((lower(name))) DO UPDATE SET category_id = EXCLUDED.category_id`, s.Name, s.CategoryID, s.CreatedBy, s.CreatedAt)
	return err
}

func (r teamRepo) Categories(ctx context.Context) ([]store.SkillCategory, error) {
	rows, _ := r.tx.Query(ctx, `SELECT id, name, created_by, created_at FROM skill_categories ORDER BY id`)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.SkillCategory, error) {
		var c store.SkillCategory
		err := row.Scan(&c.ID, &c.Name, &c.CreatedBy, &c.CreatedAt)
		return c, err
	})
	if out == nil {
		out = []store.SkillCategory{}
	}
	return out, err
}

func (r teamRepo) CreateCategory(ctx context.Context, c store.SkillCategory) (store.SkillCategory, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO skill_categories (name, created_by, created_at) VALUES ($1, $2, $3) RETURNING id`,
		c.Name, c.CreatedBy, c.CreatedAt).Scan(&c.ID)
	return c, dup(err)
}

func (r teamRepo) RenameCategory(ctx context.Context, id int64, name string) error {
	return r.mustExist(ctx, `UPDATE skill_categories SET name = $2 WHERE id = $1`, id, name)
}

func (r teamRepo) DeleteCategory(ctx context.Context, id int64) error {
	return r.mustExist(ctx, `DELETE FROM skill_categories WHERE id = $1`, id)
}

func (r teamRepo) RemoveFromCatalog(ctx context.Context, name string) error {
	return r.mustExist(ctx, `DELETE FROM skill_catalog WHERE lower(name) = lower($1)`, name)
}
