package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"tracking-service/internal/store"
)

// ---- boards ----------------------------------------------------------------

type boardRepo struct{ db }

func (r boardRepo) Create(ctx context.Context, b store.Board) (store.Board, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO boards (project_id, updated_at) VALUES ($1, $2) RETURNING id`,
		b.ProjectID, b.UpdatedAt).Scan(&b.ID)
	return b, dup(err)
}

func (r boardRepo) get(ctx context.Context, where string, arg int64) (store.Board, error) {
	var b store.Board
	err := r.tx.QueryRow(ctx, `SELECT id, project_id, updated_at FROM boards WHERE `+where, arg).Scan(&b.ID, &b.ProjectID, &b.UpdatedAt)
	return b, one(err)
}

func (r boardRepo) ByProject(ctx context.Context, projectID int64) (store.Board, error) {
	return r.get(ctx, `project_id = $1`, projectID)
}

func (r boardRepo) Get(ctx context.Context, id int64) (store.Board, error) {
	return r.get(ctx, `id = $1`, id)
}

func (r boardRepo) Lock(ctx context.Context, boardID int64) error {
	var id int64
	return one(r.tx.QueryRow(ctx, `SELECT id FROM boards WHERE id = $1 FOR UPDATE`, boardID).Scan(&id))
}

func (r boardRepo) Touch(ctx context.Context, boardID int64, at time.Time) error {
	return r.mustExist(ctx, `UPDATE boards SET updated_at = $2 WHERE id = $1`, boardID, at)
}

func (r boardRepo) Snapshot(ctx context.Context, projectID int64) (store.BoardSnapshot, error) {
	b, err := r.ByProject(ctx, projectID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	snap := store.BoardSnapshot{Board: b}
	if snap.Project, err = (projectRepo(r)).Get(ctx, projectID); err != nil {
		return store.BoardSnapshot{}, err
	}
	lists, err := listRepo(r).list(ctx, `SELECT `+listCols+` FROM lists WHERE board_id = $1 AND archived_at IS NULL
		ORDER BY position, id`, b.ID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	if len(lists) > 0 {
		snap.Lists = lists
	}
	cards, err := cardRepo(r).summaries(ctx, `l.board_id = $1 AND l.archived_at IS NULL AND c.archived_at IS NULL`, b.ID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	if len(cards) > 0 {
		snap.Cards = cards
	}
	labels, err := labelRepo(r).ByProject(ctx, projectID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	if len(labels) > 0 {
		snap.Labels = labels
	}
	members, err := memberRepo(r).List(ctx, projectID)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	if len(members) > 0 {
		snap.Members = members
	}
	// The members and everyone assigned to a card on the board, once each.
	rows, _ := r.tx.Query(ctx, `SELECT u.user_id, u.display_name, u.handle, u.avatar_url, u.synced_at FROM user_cache u
		WHERE u.user_id IN (
			SELECT user_id FROM project_members WHERE project_id = $1
			UNION
			SELECT a.user_id FROM card_assignees a JOIN cards c ON c.id = a.card_id AND c.archived_at IS NULL
			JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL WHERE l.board_id = $2)
		ORDER BY u.user_id`, projectID, b.ID)
	users, err := pgx.CollectRows(rows, scanUser)
	if err != nil {
		return store.BoardSnapshot{}, err
	}
	snap.Users = users
	return snap, nil
}

// ---- lists -----------------------------------------------------------------

type listRepo struct{ db }

const listCols = `id, board_id, name, position, is_done, wip_limit, created_at, updated_at, archived_at`

func scanList(row pgx.CollectableRow) (store.List, error) {
	var l store.List
	err := row.Scan(&l.ID, &l.BoardID, &l.Name, &l.Position, &l.IsDone, &l.WIPLimit, &l.CreatedAt, &l.UpdatedAt, &l.ArchivedAt)
	return l, err
}

func (r listRepo) list(ctx context.Context, sql string, args ...any) ([]store.List, error) {
	rows, _ := r.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, scanList)
	if out == nil {
		out = []store.List{}
	}
	return out, err
}

func (r listRepo) Create(ctx context.Context, l store.List) (store.List, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO lists (board_id, name, position, is_done, wip_limit, created_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		l.BoardID, l.Name, l.Position, l.IsDone, l.WIPLimit, l.CreatedAt, l.UpdatedAt, l.ArchivedAt).Scan(&l.ID)
	return l, dup(err)
}

func (r listRepo) ByBoard(ctx context.Context, boardID int64) ([]store.List, error) {
	return r.list(ctx, `SELECT `+listCols+` FROM lists WHERE board_id = $1 ORDER BY position, id`, boardID)
}

func (r listRepo) Get(ctx context.Context, id int64) (store.List, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+listCols+` FROM lists WHERE id = $1`, id)
	l, err := pgx.CollectExactlyOneRow(rows, scanList)
	return l, one(err)
}

func (r listRepo) Save(ctx context.Context, l store.List) error {
	return r.mustExist(ctx, `UPDATE lists SET board_id = $2, name = $3, position = $4, is_done = $5, wip_limit = $6,
		created_at = $7, updated_at = $8, archived_at = $9 WHERE id = $1`,
		l.ID, l.BoardID, l.Name, l.Position, l.IsDone, l.WIPLimit, l.CreatedAt, l.UpdatedAt, l.ArchivedAt)
}

func (r listRepo) Positions(ctx context.Context, boardID int64) ([]store.IDPos, error) {
	return r.positions(ctx, `SELECT id, position, archived_at IS NOT NULL FROM lists WHERE board_id = $1 ORDER BY position, id`, boardID)
}

func (q db) positions(ctx context.Context, sql string, arg int64) ([]store.IDPos, error) {
	rows, _ := q.tx.Query(ctx, sql, arg)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.IDPos, error) {
		var p store.IDPos
		err := row.Scan(&p.ID, &p.Position, &p.Archived)
		return p, err
	})
	if out == nil {
		out = []store.IDPos{}
	}
	return out, err
}

// setPositions is the two-step rewrite every ordered table needs: its unique
// (container, position) index is checked row by row, so a plain UPDATE that
// swaps two keys would collide half way. Step 1 parks the rows being moved,
// and any other live row of the same container that holds one of the new
// keys (the row the caller is moving, which it Saves afterwards), on a key no
// LexoRank uses ('~' sorts after every rank character). Step 2 writes the
// new keys.
func (q db) setPositions(ctx context.Context, table, container, live string, ps []store.IDPos) error {
	if len(ps) == 0 {
		return nil
	}
	ids := make([]int64, len(ps))
	pos := make([]string, len(ps))
	for i, p := range ps {
		ids[i], pos[i] = p.ID, p.Position
	}
	if _, err := q.exec(ctx, `UPDATE `+table+` SET position = '~' || id WHERE id = ANY($1)
		OR (`+container+` IN (SELECT `+container+` FROM `+table+` WHERE id = ANY($1))
			AND position = ANY($2) AND id <> ALL($1)`+live+`)`, ids, pos); err != nil {
		return err
	}
	n, err := q.exec(ctx, `UPDATE `+table+` t SET position = v.position
		FROM unnest($1::bigint[], $2::text[]) AS v(id, position) WHERE t.id = v.id`, ids, pos)
	if err == nil && n != int64(len(ps)) {
		return store.ErrNotFound
	}
	return err
}

func (r listRepo) SetPositions(ctx context.Context, ps []store.IDPos) error {
	return r.setPositions(ctx, "lists", "board_id", " AND archived_at IS NULL", ps)
}

func (r listRepo) Archived(ctx context.Context, boardID int64) ([]store.List, []store.CardSummary, error) {
	lists, err := r.list(ctx, `SELECT `+listCols+` FROM lists WHERE board_id = $1 AND archived_at IS NOT NULL
		ORDER BY position, id`, boardID)
	if err != nil {
		return nil, nil, err
	}
	cards, err := cardRepo(r).summaries(ctx, `l.board_id = $1 AND c.archived_at IS NOT NULL`, boardID)
	return lists, cards, err
}

// ---- cards -----------------------------------------------------------------

type cardRepo struct{ db }

const cardCols = `id, list_id, title, description_md, priority, start_date::text, due_date::text, position,
	created_by, created_at, completed_at, updated_at, archived_at`

func scanCard(row pgx.CollectableRow) (store.Card, error) {
	var c store.Card
	var start, due *string
	err := row.Scan(&c.ID, &c.ListID, &c.Title, &c.Description, &c.Priority, &start, &due, &c.Position,
		&c.CreatedBy, &c.CreatedAt, &c.CompletedAt, &c.UpdatedAt, &c.ArchivedAt)
	c.StartDate, c.DueDate = toDate(start), toDate(due)
	return c, err
}

// summaries reads the board view of the cards matching where (over cards c
// JOIN lists l), ordered by position then id: counts and ids in the same
// query, then the checklist previews in one more.
func (r cardRepo) summaries(ctx context.Context, where string, arg int64) ([]store.CardSummary, error) {
	rows, _ := r.tx.Query(ctx, `SELECT c.id, c.list_id, c.title, c.priority, c.start_date::text, c.due_date::text,
		c.position, c.completed_at, c.archived_at, c.updated_at,
		COALESCE((SELECT array_agg(label_id ORDER BY label_id) FROM card_labels WHERE card_id = c.id), '{}'),
		COALESCE((SELECT array_agg(user_id ORDER BY user_id) FROM card_assignees WHERE card_id = c.id), '{}'),
		(SELECT count(*) FROM checklist_items WHERE card_id = c.id),
		(SELECT count(*) FROM checklist_items WHERE card_id = c.id AND is_done),
		(SELECT count(*) FROM comments WHERE card_id = c.id AND deleted_at IS NULL)
		FROM cards c JOIN lists l ON l.id = c.list_id
		WHERE `+where+` ORDER BY c.position, c.id`, arg)
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (store.CardSummary, error) {
		var s store.CardSummary
		var start, due *string
		err := row.Scan(&s.ID, &s.ListID, &s.Title, &s.Priority, &start, &due, &s.Position, &s.CompletedAt,
			&s.ArchivedAt, &s.UpdatedAt, &s.LabelIDs, &s.AssigneeIDs, &s.ChecklistTotal, &s.ChecklistDone, &s.CommentCount)
		s.StartDate, s.DueDate = toDate(start), toDate(due)
		s.ChecklistPreview = []store.ChecklistItem{}
		return s, err
	})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return []store.CardSummary{}, nil
	}
	ids := make([]int64, len(out))
	at := make(map[int64]int, len(out))
	for i, s := range out {
		ids[i], at[s.ID] = s.ID, i
	}
	rows, _ = r.tx.Query(ctx, `SELECT `+itemCols+` FROM (
		SELECT *, row_number() OVER (PARTITION BY card_id ORDER BY position, id) AS n
		FROM checklist_items WHERE card_id = ANY($1)) t WHERE n <= 3 ORDER BY card_id, position, id`, ids)
	items, err := pgx.CollectRows(rows, scanItem)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		s := &out[at[it.CardID]]
		s.ChecklistPreview = append(s.ChecklistPreview, it)
	}
	return out, nil
}

func (r cardRepo) Create(ctx context.Context, c store.Card) (store.Card, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO cards (list_id, title, description_md, priority, start_date, due_date, position,
		created_by, created_at, completed_at, updated_at, archived_at)
		VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12) RETURNING id`,
		c.ListID, c.Title, c.Description, c.Priority, dateArg(c.StartDate), dateArg(c.DueDate), c.Position,
		c.CreatedBy, c.CreatedAt, c.CompletedAt, c.UpdatedAt, c.ArchivedAt).Scan(&c.ID)
	return c, dup(err)
}

func (r cardRepo) Get(ctx context.Context, id int64) (store.Card, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+cardCols+` FROM cards WHERE id = $1`, id)
	c, err := pgx.CollectExactlyOneRow(rows, scanCard)
	return c, one(err)
}

func (r cardRepo) Save(ctx context.Context, c store.Card) error {
	return r.mustExist(ctx, `UPDATE cards SET list_id = $2, title = $3, description_md = $4, priority = $5,
		start_date = $6::date, due_date = $7::date, position = $8, created_by = $9, created_at = $10,
		completed_at = $11, updated_at = $12, archived_at = $13 WHERE id = $1`,
		c.ID, c.ListID, c.Title, c.Description, c.Priority, dateArg(c.StartDate), dateArg(c.DueDate), c.Position,
		c.CreatedBy, c.CreatedAt, c.CompletedAt, c.UpdatedAt, c.ArchivedAt)
}

func (r cardRepo) SetCompletedForList(ctx context.Context, listID int64, at *time.Time) error {
	var err error
	if at != nil {
		_, err = r.exec(ctx, `UPDATE cards SET completed_at = $2 WHERE list_id = $1 AND archived_at IS NULL
			AND completed_at IS NULL`, listID, *at)
	} else {
		_, err = r.exec(ctx, `UPDATE cards SET completed_at = NULL WHERE list_id = $1 AND archived_at IS NULL
			AND completed_at IS NOT NULL`, listID)
	}
	return err
}

func (r cardRepo) Touch(ctx context.Context, cardID int64, at time.Time) error {
	return r.mustExist(ctx, `UPDATE cards SET updated_at = $2 WHERE id = $1`, cardID, at)
}

func (r cardRepo) LockList(ctx context.Context, listID int64) error {
	var id int64
	return one(r.tx.QueryRow(ctx, `SELECT id FROM lists WHERE id = $1 FOR UPDATE`, listID).Scan(&id))
}

func (r cardRepo) Positions(ctx context.Context, listID int64) ([]store.IDPos, error) {
	return r.positions(ctx, `SELECT id, position, archived_at IS NOT NULL FROM cards WHERE list_id = $1 ORDER BY position, id`, listID)
}

func (r cardRepo) SetPositions(ctx context.Context, ps []store.IDPos) error {
	return r.setPositions(ctx, "cards", "list_id", " AND archived_at IS NULL", ps)
}

func (r cardRepo) exists(ctx context.Context, cardID int64) error {
	var ok bool
	if err := r.tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cards WHERE id = $1)`, cardID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return store.ErrNotFound
	}
	return nil
}

func (r cardRepo) AddAssignee(ctx context.Context, cardID, userID int64, at time.Time) (bool, error) {
	if err := r.exists(ctx, cardID); err != nil {
		return false, err
	}
	n, err := r.exec(ctx, `INSERT INTO card_assignees (card_id, user_id, assigned_at) VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING`, cardID, userID, at)
	return n == 1, err
}

func (r cardRepo) RemoveAssignee(ctx context.Context, cardID, userID int64) (bool, error) {
	n, err := r.exec(ctx, `DELETE FROM card_assignees WHERE card_id = $1 AND user_id = $2`, cardID, userID)
	return n == 1, err
}

func (r cardRepo) UnassignInProject(ctx context.Context, projectID, userID int64) ([]int64, error) {
	return r.ids(ctx, `WITH gone AS (
		DELETE FROM card_assignees ca USING cards c, lists l, boards b
		WHERE ca.card_id = c.id AND c.list_id = l.id AND l.board_id = b.id AND b.project_id = $1 AND ca.user_id = $2
		RETURNING ca.card_id) SELECT card_id FROM gone ORDER BY card_id`, projectID, userID)
}

func (r cardRepo) AddLabel(ctx context.Context, cardID, labelID int64) (bool, error) {
	if err := r.exists(ctx, cardID); err != nil {
		return false, err
	}
	n, err := r.exec(ctx, `INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, cardID, labelID)
	return n == 1, err
}

func (r cardRepo) RemoveLabel(ctx context.Context, cardID, labelID int64) (bool, error) {
	n, err := r.exec(ctx, `DELETE FROM card_labels WHERE card_id = $1 AND label_id = $2`, cardID, labelID)
	return n == 1, err
}

func (r cardRepo) Children(ctx context.Context, cardID int64) (store.CardChildren, error) {
	var ch store.CardChildren
	var err error
	if ch.AssigneeIDs, err = r.ids(ctx, `SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY user_id`, cardID); err != nil {
		return ch, err
	}
	if ch.LabelIDs, err = r.ids(ctx, `SELECT label_id FROM card_labels WHERE card_id = $1 ORDER BY label_id`, cardID); err != nil {
		return ch, err
	}
	ch.Checklist, err = checklistRepo(r).list(ctx, `SELECT `+itemCols+` FROM checklist_items WHERE card_id = $1 ORDER BY position, id`, cardID)
	return ch, err
}

// ---- checklist -------------------------------------------------------------

type checklistRepo struct{ db }

const itemCols = `id, card_id, text, is_done, position, updated_at`

func scanItem(row pgx.CollectableRow) (store.ChecklistItem, error) {
	var it store.ChecklistItem
	err := row.Scan(&it.ID, &it.CardID, &it.Text, &it.IsDone, &it.Position, &it.UpdatedAt)
	return it, err
}

func (r checklistRepo) list(ctx context.Context, sql string, args ...any) ([]store.ChecklistItem, error) {
	rows, _ := r.tx.Query(ctx, sql, args...)
	out, err := pgx.CollectRows(rows, scanItem)
	if out == nil {
		out = []store.ChecklistItem{}
	}
	return out, err
}

func (r checklistRepo) LockCard(ctx context.Context, cardID int64) error {
	var id int64
	return one(r.tx.QueryRow(ctx, `SELECT id FROM cards WHERE id = $1 FOR UPDATE`, cardID).Scan(&id))
}

func (r checklistRepo) Create(ctx context.Context, it store.ChecklistItem) (store.ChecklistItem, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO checklist_items (card_id, text, is_done, position, updated_at)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`, it.CardID, it.Text, it.IsDone, it.Position, it.UpdatedAt).Scan(&it.ID)
	return it, dup(err)
}

func (r checklistRepo) Get(ctx context.Context, id int64) (store.ChecklistItem, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+itemCols+` FROM checklist_items WHERE id = $1`, id)
	it, err := pgx.CollectExactlyOneRow(rows, scanItem)
	return it, one(err)
}

func (r checklistRepo) Save(ctx context.Context, it store.ChecklistItem) error {
	return r.mustExist(ctx, `UPDATE checklist_items SET card_id = $2, text = $3, is_done = $4, position = $5,
		updated_at = $6 WHERE id = $1`, it.ID, it.CardID, it.Text, it.IsDone, it.Position, it.UpdatedAt)
}

func (r checklistRepo) Delete(ctx context.Context, id int64) error {
	return r.mustExist(ctx, `DELETE FROM checklist_items WHERE id = $1`, id)
}

func (r checklistRepo) Positions(ctx context.Context, cardID int64) ([]store.IDPos, error) {
	return r.positions(ctx, `SELECT id, position, false FROM checklist_items WHERE card_id = $1 ORDER BY position, id`, cardID)
}

func (r checklistRepo) SetPositions(ctx context.Context, ps []store.IDPos) error {
	return r.setPositions(ctx, "checklist_items", "card_id", "", ps)
}

// ---- labels ----------------------------------------------------------------

type labelRepo struct{ db }

func scanLabel(row pgx.CollectableRow) (store.Label, error) {
	var l store.Label
	err := row.Scan(&l.ID, &l.ProjectID, &l.Name, &l.Color)
	return l, err
}

func (r labelRepo) Create(ctx context.Context, l store.Label) (store.Label, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO labels (project_id, name, color) VALUES ($1, $2, $3) RETURNING id`,
		l.ProjectID, l.Name, l.Color).Scan(&l.ID)
	return l, dup(err)
}

func (r labelRepo) Get(ctx context.Context, id int64) (store.Label, error) {
	rows, _ := r.tx.Query(ctx, `SELECT id, project_id, name, color FROM labels WHERE id = $1`, id)
	l, err := pgx.CollectExactlyOneRow(rows, scanLabel)
	return l, one(err)
}

func (r labelRepo) Save(ctx context.Context, l store.Label) error {
	return r.mustExist(ctx, `UPDATE labels SET name = $2, color = $3 WHERE id = $1`, l.ID, l.Name, l.Color)
}

func (r labelRepo) ByProject(ctx context.Context, projectID int64) ([]store.Label, error) {
	rows, _ := r.tx.Query(ctx, `SELECT id, project_id, name, color FROM labels WHERE project_id = $1 ORDER BY id`, projectID)
	out, err := pgx.CollectRows(rows, scanLabel)
	if out == nil {
		out = []store.Label{}
	}
	return out, err
}

func (r labelRepo) NameTaken(ctx context.Context, projectID int64, name string, exceptID int64) (bool, error) {
	var taken bool
	err := r.tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM labels WHERE project_id = $1
		AND lower(name) = lower($2) AND id <> $3)`, projectID, name, exceptID).Scan(&taken)
	return taken, err
}

func (r labelRepo) Delete(ctx context.Context, id int64) ([]int64, error) {
	cards, err := r.ids(ctx, `WITH gone AS (DELETE FROM card_labels WHERE label_id = $1 RETURNING card_id)
		SELECT card_id FROM gone ORDER BY card_id`, id)
	if err != nil {
		return nil, err
	}
	if err := r.mustExist(ctx, `DELETE FROM labels WHERE id = $1`, id); err != nil {
		return nil, err
	}
	return cards, nil
}

// ---- comments --------------------------------------------------------------

type commentRepo struct{ db }

const commentCols = `id, card_id, author_id, body_md, created_at, edited_at, deleted_at`

func scanComment(row pgx.CollectableRow) (store.Comment, error) {
	var c store.Comment
	err := row.Scan(&c.ID, &c.CardID, &c.AuthorID, &c.Body, &c.CreatedAt, &c.EditedAt, &c.DeletedAt)
	return c, err
}

func (r commentRepo) Create(ctx context.Context, c store.Comment) (store.Comment, error) {
	err := r.tx.QueryRow(ctx, `INSERT INTO comments (card_id, author_id, body_md, created_at, edited_at, deleted_at)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, c.CardID, c.AuthorID, c.Body, c.CreatedAt, c.EditedAt, c.DeletedAt).Scan(&c.ID)
	return c, dup(err)
}

func (r commentRepo) Get(ctx context.Context, id int64) (store.Comment, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+commentCols+` FROM comments WHERE id = $1`, id)
	c, err := pgx.CollectExactlyOneRow(rows, scanComment)
	return c, one(err)
}

func (r commentRepo) Save(ctx context.Context, c store.Comment) error {
	return r.mustExist(ctx, `UPDATE comments SET body_md = $2, edited_at = $3, deleted_at = $4 WHERE id = $1`,
		c.ID, c.Body, c.EditedAt, c.DeletedAt)
}

func (r commentRepo) ByCard(ctx context.Context, cardID int64) ([]store.Comment, error) {
	rows, _ := r.tx.Query(ctx, `SELECT `+commentCols+` FROM comments WHERE card_id = $1 AND deleted_at IS NULL
		ORDER BY created_at, id`, cardID)
	out, err := pgx.CollectRows(rows, scanComment)
	if out == nil {
		out = []store.Comment{}
	}
	return out, err
}

func (r commentRepo) Mentions(ctx context.Context, commentID int64) ([]int64, error) {
	return r.ids(ctx, `SELECT user_id FROM comment_mentions WHERE comment_id = $1 ORDER BY user_id`, commentID)
}

func (r commentRepo) MentionsByCard(ctx context.Context, cardID int64) (map[int64][]int64, error) {
	rows, _ := r.tx.Query(ctx, `SELECT m.comment_id, m.user_id FROM comment_mentions m JOIN comments c ON c.id = m.comment_id
		WHERE c.card_id = $1 AND c.deleted_at IS NULL ORDER BY m.comment_id, m.user_id`, cardID)
	out := map[int64][]int64{}
	var cid, uid int64
	_, err := pgx.ForEachRow(rows, []any{&cid, &uid}, func() error {
		out[cid] = append(out[cid], uid)
		return nil
	})
	return out, err
}

func (r commentRepo) SetMentions(ctx context.Context, commentID int64, userIDs []int64) error {
	if _, err := r.exec(ctx, `DELETE FROM comment_mentions WHERE comment_id = $1`, commentID); err != nil {
		return err
	}
	if len(userIDs) == 0 {
		return nil
	}
	_, err := r.exec(ctx, `INSERT INTO comment_mentions (comment_id, user_id) SELECT $1, unnest($2::bigint[])`, commentID, userIDs)
	return err
}
