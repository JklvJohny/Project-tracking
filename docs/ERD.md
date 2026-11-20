# Project Tracking: ERD (proposal)

PostgreSQL, schema `tracking`, owned only by `tracking-service`. Status: **proposal**, not yet migrated. The runnable DDL for the tables the code uses today is [backend/db/schema.sql](../backend/db/schema.sql).

**Single department (decided 2026-11-17):** there is no Workspace level. Projects sit at the top, and the only roles above project level are in `user_roles`.

## P1: core (build first)

```mermaid
erDiagram
    user_cache ||..o| user_roles : "user_id (no FK, external)"
    projects ||--o{ project_members : has
    skill_categories |o--o{ skill_catalog : groups
    projects ||--|| boards : "has one"
    projects ||--o{ labels : defines
    boards ||--o{ lists : contains
    lists ||--o{ cards : holds
    cards ||--o{ card_assignees : has
    cards ||--o{ card_labels : has
    labels ||--o{ card_labels : tags
    cards ||--o{ checklist_items : has
    cards ||--o{ comments : has
    comments ||--o{ comment_mentions : mentions
    user_cache ||..o{ card_assignees : "user_id (no FK, external)"
    user_cache ||..o{ project_members : "user_id (no FK, external)"

    user_roles {
        bigint user_id PK "from user-service"
        text role "admin | manager"
        timestamptz granted_at
        bigint granted_by "user_id"
    }
    user_cache {
        bigint user_id PK "copy from user-service"
        text display_name
        text handle "for @mention"
        text avatar_url
        timestamptz synced_at
    }
    user_skills {
        bigint user_id PK "user-service id"
        text skill PK "free text tag, 1-40 chars; unique per user case-insensitively"
        int position "order the person listed them"
    }
    skill_catalog {
        text name PK "1-40 chars; unique by lower(name)"
        bigint category_id FK "nullable: uncategorised; ON DELETE SET NULL"
        bigint created_by "user_id"
        timestamptz created_at
    }
    skill_categories {
        bigint id PK "identity; listed in this order"
        text name "1-40 chars; unique by lower(name)"
        bigint created_by "user_id"
        timestamptz created_at
    }
    user_avatars {
        bigint user_id PK "user-service id; one picture per person"
        text storage_key "blob key of a 256x256 JPEG"
        timestamptz updated_at "also the URL version (?v=)"
    }
    projects {
        bigint id PK "identity"
        text name "UK lower(name) among non-archived"
        text description
        bigint owner_id "user_id"
        text status "active | on_hold | done"
        date start_date
        date end_date "CHECK end >= start"
        bigint created_by "user_id"
        timestamptz created_at
        timestamptz updated_at
        timestamptz archived_at "null = not archived"
    }
    project_members {
        bigint project_id PK,FK
        bigint user_id PK
        text role "pm | member | viewer"
        timestamptz added_at
    }
    boards {
        bigint id PK "identity"
        bigint project_id FK,UK "1 board per project"
        timestamptz updated_at "bumped by list/card writes (ETag)"
    }
    lists {
        bigint id PK "identity"
        bigint board_id FK
        text name
        text position "LexoRank, COLLATE C"
        boolean is_done "counts as Done"
        int wip_limit "P3, null"
        timestamptz created_at
        timestamptz updated_at
        timestamptz archived_at
    }
    cards {
        bigint id PK "identity"
        bigint list_id FK
        text title
        text description_md
        smallint priority "0 low, 1 medium, 2 high, 3 urgent"
        date start_date
        date due_date "CHECK due >= start"
        text position "LexoRank, COLLATE C"
        bigint created_by "user_id"
        timestamptz created_at
        timestamptz completed_at "set on move into an is_done list"
        timestamptz updated_at "bumped by every child write"
        timestamptz archived_at
    }
    card_assignees {
        bigint card_id PK,FK
        bigint user_id PK
        timestamptz assigned_at
    }
    labels {
        bigint id PK "identity"
        bigint project_id FK
        text name "UK per project, case-insensitive"
        text color "green | yellow | red | blue | purple | gray"
    }
    card_labels {
        bigint card_id PK,FK
        bigint label_id PK,FK
    }
    checklist_items {
        bigint id PK "identity"
        bigint card_id FK
        text text
        boolean is_done
        text position "LexoRank, COLLATE C"
        timestamptz updated_at
    }
    comments {
        bigint id PK "identity"
        bigint card_id FK
        bigint author_id "user_id"
        text body_md
        timestamptz created_at
        timestamptz edited_at
        timestamptz deleted_at "soft delete"
    }
    comment_mentions {
        bigint comment_id PK,FK
        bigint user_id PK
    }
```

## P2 / P3: later phases (same schema, added by later migrations)

```mermaid
erDiagram
    projects ||--o{ activity_events : "P2 log"
    cards |o--o{ activity_events : "about (optional)"
    cards ||--o{ attachments : "P2"
    projects ||--o{ documents : "P3 Reports"
    projects ||--o{ folder_shares : "report folder shared outside the project"
    projects ||--o{ import_jobs : "P3"
    import_jobs ||--o{ import_rows : drafts
    import_jobs |o--o{ cards : "created from"
    user_cache ||..o{ notifications : "user_id"

    activity_events {
        bigint id PK "identity; PK (id, created_at)"
        bigint project_id FK
        bigint card_id "null for project-level"
        bigint actor_id "user_id"
        text type "card.moved, card.updated, ..."
        jsonb payload
        timestamptz created_at "partition key (monthly)"
    }
    notifications {
        bigint id PK "identity"
        bigint user_id
        text type "assigned | mentioned | comment | due_soon | overdue"
        jsonb payload
        timestamptz created_at
        timestamptz read_at
    }
    notification_prefs {
        bigint user_id PK
        text type PK
        boolean in_app
        boolean email
    }
    attachments {
        bigint id PK "identity"
        bigint card_id FK
        text storage_key "./uploads or MinIO"
        text filename
        text mime_type
        bigint size_bytes
        bigint uploaded_by "user_id"
        timestamptz created_at
    }
    documents {
        bigint id PK "identity"
        bigint project_id FK
        text storage_key
        text filename
        text mime_type "application/pdf"
        bigint size_bytes
        bigint uploaded_by "user_id"
        timestamptz created_at
        timestamptz deleted_at
    }
    folder_shares {
        bigint project_id PK,FK
        bigint user_id PK "user-service id; never a member of the project; INDEX (user_id)"
        bigint shared_by "user_id"
        timestamptz created_at
    }
    report_templates {
        bigint id PK "identity"
        text category "free text, 1-60 chars"
        text name "1-120 chars"
        text description "0-500 chars"
        text storage_key
        text filename
        text mime_type "docx | xlsx | pptx | doc | xls | ppt | pdf"
        bigint size_bytes
        bigint uploaded_by "user_id"
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }
    import_jobs {
        bigint id PK "identity"
        bigint project_id FK
        bigint list_id FK "destination"
        text source_type "template | po (po parked)"
        text storage_key
        text status "processing | review | done | failed"
        text error_code
        bigint created_by "user_id"
        timestamptz created_at
    }
    import_rows {
        bigint id PK "identity"
        bigint job_id FK
        int row_no
        jsonb data "title, dates, label, assignee..."
        jsonb warnings
        boolean included
    }
    user_prefs {
        bigint user_id PK
        text lang "th | en"
        text theme "light | dark | system"
        numeric board_split "0.15 - 0.85"
    }
```

## Rules the diagram cannot show

- **Keys:** `bigint GENERATED ALWAYS AS IDENTITY`. Integer keys are enough for one department. They are `bigint` rather than `int` because sqlc maps `bigint` to Go `int64`, the type the Go code uses everywhere. `int` would need `int32` conversions.
- **Optimistic create:** the database assigns the id, so the frontend shows a new card with a temporary client id and replaces it with the real id from the response.
- **Users are external:** every column that points at a person (`user_id`, `owner_id`, `created_by`, `author_id`, ...) holds the user-service id. There is no FK and no users table. Names and avatars come from `user_cache`. user-service ids are integers (confirmed 2026-11-17). These columns are `bigint`, which holds any `int` value, and it matches the `int64` the Go code already uses.
- **Roles above project level:** `user_roles` holds only the exceptions. `admin` can do everything, including managing `user_roles`. `manager` can create projects and becomes PM of each one it creates. A user with no row is a regular user, who sees only the projects listed for them in `project_members`. One role per user (`user_id` is the PK).
- **Project roles are separate:** `project_members.role` (`pm | member | viewer`) is not a reference to `user_roles`. It is its own value with a CHECK.
- **Enums:** `text` + `CHECK (... IN (...))` for values with no order (`status`, `role`, `color`, `type`). The value can be read directly in the database, logs and API, and adding a value is a cheap migration. `priority` is the exception: `smallint CHECK (priority BETWEEN 0 AND 3)`, because it has an order and `ORDER BY priority DESC` sorts it directly. The API sends the names `low | medium | high | urgent`, never the numbers.
- **Archive is not a status:** `projects.status` is the work state (`active | on_hold | done`). `archived_at` alone says whether a project is archived, so the two can never disagree.
- **Board load joins lists:** `cards` has no `board_id`. A board loads with `cards JOIN lists ON lists.id = cards.list_id WHERE lists.board_id = $1`, using the indexes on `lists (board_id)` and `cards (list_id, position)`.
- **Same-project rule:** `card_labels` must join a label from the card's own project. The service checks this, because the database cannot enforce it without `project_id` on `cards`.
- **Board load selects only what the board shows:** title, priority, dates, `completed_at`, labels, assignees, checklist and comment counts. `description_md` and comment bodies load when a card is opened. Card children load as one query per child table for the whole board (`WHERE card_id IN (...)`), never one query per card.
- **Ordering:** `position text COLLATE "C"`.
  - The unique indexes on positions skip archived rows (`WHERE archived_at IS NULL`): an archived card keeps its old key, and a new key computed between visible neighbours could otherwise collide with it.
  - Unarchiving a card or list gives it a new key at the end of its list or board.
  - Checklist items have no archive, so `UNIQUE (card_id, position)` covers all of them.
- **Completion:** `cards.completed_at` is set when a card moves into a list with `is_done = true`, and cleared when it moves out, in the same transaction as the move. Done, overdue, "done this week" and the Gantt read it from `cards` alone, with no join to `lists`.
- **"Today" is Bangkok time:** the database runs with `ALTER DATABASE ... SET timezone = 'Asia/Bangkok'`, so `current_date` matches the user's day. Without it, a UTC server shows a card due yesterday as not yet overdue between 00:00 and 07:00 Thai time.
- **Search:** `ILIKE '%term%'` on `title` (and `description_md` when asked), limited to the projects the caller can see. There is no `tsvector`: PostgreSQL has no Thai word splitter, so `ออกแบบหน้าแรก` would be one token and `หน้าแรก` would not match it.
  - At one department's size (thousands of cards) the scan takes milliseconds.
  - Add a `pg_trgm` GIN index only if `EXPLAIN ANALYZE` shows search over budget. First check `SELECT show_trgm('ออกแบบหน้าแรก')`: Thai vowel and tone marks must not split the trigrams under the database locale.
- **Uniqueness:**
  - `boards.project_id` is UNIQUE.
  - Project names are unique ignoring case, but only among projects that are not archived. A new project can reuse the name of an archived one.
  - Label names are unique per project, ignoring case.
- **ETag:**
  - Every write to a card's children (assignee, label, checklist, comment) bumps `cards.updated_at` in the same transaction.
  - Every write that changes what the board shows bumps `boards.updated_at`. That covers lists, cards, assignees, card labels, checklist items, comments, project labels and members.
  - The ETag hashes `boards.updated_at` with the caller's role.
- **Archive, never purge:**
  - `archived_at` and `deleted_at` hide rows. Nobody hard-deletes a project, so all history stays for audit.
  - FKs from a project down to card children use the default `ON DELETE NO ACTION`, so an accidental `DELETE` fails instead of cascading.
  - Join rows are the exception: removing an assignee, a card label, a project member or a mention deletes that row.
- **Retention and growth:**
  - `activity_events` are kept forever, partitioned by month on `created_at`. A partitioned table needs the partition key in its PK, so the PK is `(id, created_at)`.
  - `activity_events.payload` holds only what changed, as ids and values (`{"from_list":12,"to_list":14}`). It never holds names, titles or whole-row snapshots. Names come from current rows at read time.
  - Size estimate for `activity_events`: 20 users × 50 events a day × 250 working days ≈ 250,000 rows a year, at about 300 bytes each with indexes. That is under 100 MB a year.
  - `notifications` older than 1 year are deleted by a daily background job.
  - `import_rows` are drafts. They are deleted when their job reaches `done`. Rows of a `failed` job are deleted after 7 days. The `import_jobs` row stays as the record. The uploaded file is deleted with its rows.
  - Files live outside the database (`./uploads`, MinIO later). The database stores only metadata.
- **Size limits:** text columns have `CHECK (char_length(...) <= n)`: card and project title 200, `description_md` 20,000, comment body 5,000, checklist text 500. These are defaults: change them in one migration if users need more. The service validates the same limits first, so the user gets a clear message instead of a constraint error.
- **Dates:**
  - Every timestamp column is `timestamptz`.
  - `end_date >= start_date` and `due_date >= start_date` are CHECK constraints in the database as well as in the service.

## Indexes (from the performance skill)

Only indexes that a screen's query uses. Each one costs space and slows every write, so do not add one without an `EXPLAIN` that needs it. `projects` has no `status` index: a department has few projects, and a sequential scan is faster.

```sql
CREATE UNIQUE INDEX ON projects (lower(name)) WHERE archived_at IS NULL;
CREATE INDEX ON project_members (user_id);                       -- "my projects", permission check
CREATE UNIQUE INDEX ON lists (board_id, position)
  WHERE archived_at IS NULL;                                     -- board load + order
CREATE UNIQUE INDEX ON cards (list_id, position)
  WHERE archived_at IS NULL;                                     -- board load + order + LexoRank gap
CREATE INDEX ON cards (due_date)
  WHERE archived_at IS NULL AND completed_at IS NULL;            -- overdue / due soon, dashboard
CREATE INDEX ON card_assignees (user_id);                        -- My Tasks, workload
CREATE UNIQUE INDEX ON labels (project_id, lower(name));
CREATE UNIQUE INDEX ON checklist_items (card_id, position);      -- also serves "items of a card"
CREATE INDEX ON comments (card_id) WHERE deleted_at IS NULL;
CREATE INDEX ON activity_events (project_id, created_at DESC);   -- P2, created on each partition
CREATE INDEX ON notifications (user_id, created_at DESC);        -- P2, notification list
CREATE INDEX ON notifications (user_id) WHERE read_at IS NULL;   -- P2, unread badge
CREATE INDEX ON notifications (created_at);                      -- P2, daily 1-year cleanup
CREATE INDEX idx_report_templates_live ON report_templates (lower(category), lower(name), id) WHERE deleted_at IS NULL; -- Reports > Templates list
CREATE UNIQUE INDEX ux_user_skills ON user_skills (user_id, lower(skill)); -- one spelling per tag per person; the PK (user_id, skill) alone lets "Go" and "go" both in
CREATE UNIQUE INDEX ux_skill_catalog ON skill_catalog (lower(name)); -- the department list: "Go" and "go" are one skill
CREATE UNIQUE INDEX ux_skill_categories_name ON skill_categories (lower(name)); -- "Network" and "network" are one category
```

## Business decisions (2026-11-17)

1. **No purge.** Projects are only archived. Cards, comments and attachments are never hard-deleted.
2. **Admin sees every project** and can manage it without being added to `project_members`.
3. **Retention:** `activity_events` are kept forever. `notifications` are kept for 1 year.
4. **Labels are per project.**
5. **Only `admin` and `manager` can create projects.** The creator becomes PM of the new project.