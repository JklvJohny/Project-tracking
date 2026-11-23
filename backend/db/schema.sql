-- Project Tracking: PostgreSQL schema for tracking-service.
--
-- Source of truth: docs/ERD.md and docs/db-contract.md (the "SQL:" obligation
-- on every repo method in backend/internal/store/repos.go). Keep the three in
-- step: a column or index added here is added there in the same change.
--
-- How to run (pgAdmin):
--   1. Create an empty database, e.g. "tracking", and connect to it.
--   2. Open this file in the Query Tool and run all of it (F5).
--   It runs in one transaction: on any error nothing is created.
--   It is meant for an empty database. To start over:
--   DROP SCHEMA tracking CASCADE;   (this deletes every tracking table and row)
--
-- Needs PostgreSQL 14 or newer.
--
-- Not created yet, because no code uses them: notifications,
-- notification_prefs, attachments, import_jobs, import_rows, user_prefs, and
-- the worker's job queue. They come with their features.

BEGIN;

CREATE SCHEMA IF NOT EXISTS tracking;
SET LOCAL search_path = tracking;

-- tracking-service connects as tracking_app. Its settings below apply to that
-- role in this database only, so other services sharing the server or the
-- database keep theirs. No password here: the DBA sets it afterwards with
--   ALTER ROLE tracking_app PASSWORD '...';
-- Creating a role needs CREATEROLE (or superuser) for whoever runs this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracking_app') THEN
    CREATE ROLE tracking_app LOGIN;
  END IF;
  -- "Today" is Bangkok time, so current_date matches the user's day: without it
  -- a card due yesterday shows as not overdue between 00:00 and 07:00 Thai time.
  EXECUTE format('ALTER ROLE tracking_app IN DATABASE %I SET timezone = %L', current_database(), 'Asia/Bangkok');
  EXECUTE format('ALTER ROLE tracking_app IN DATABASE %I SET search_path = tracking', current_database());
END
$$;

-- ---------------------------------------------------------------------------
-- People. Every column that points at a person holds the user-service id:
-- there is no users table and no foreign key to one.
-- ---------------------------------------------------------------------------

-- Only the exceptions: admin (everything) and manager (creates projects).
CREATE TABLE user_roles (
  user_id    bigint      PRIMARY KEY,
  role       text        NOT NULL CHECK (role IN ('admin', 'manager')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by bigint      NOT NULL
);

-- A copy of user-service names and avatars, for display and @mentions.
CREATE TABLE user_cache (
  user_id      bigint      PRIMARY KEY,
  display_name text        NOT NULL,
  handle       text        NOT NULL DEFAULT '',
  avatar_url   text        NOT NULL DEFAULT '',
  synced_at    timestamptz NOT NULL DEFAULT now()
);

-- Profile picture uploaded in tracking; the bytes live in the blob store.
CREATE TABLE user_avatars (
  user_id     bigint      PRIMARY KEY,
  storage_key text        NOT NULL,
  updated_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Skills (Team page)
-- ---------------------------------------------------------------------------

CREATE TABLE skill_categories (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  created_by bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- "Network" and "network" are one category.
CREATE UNIQUE INDEX ux_skill_categories_name ON skill_categories (lower(name));

-- The department's list of named skills, offered before anyone has them.
CREATE TABLE skill_catalog (
  name        text        PRIMARY KEY CHECK (char_length(name) BETWEEN 1 AND 40),
  category_id bigint      NULL REFERENCES skill_categories (id) ON DELETE SET NULL,
  created_by  bigint      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- "Go" and "go" are one skill.
CREATE UNIQUE INDEX ux_skill_catalog ON skill_catalog (lower(name));

-- A person's skill tags, in the order they listed them.
CREATE TABLE user_skills (
  user_id  bigint NOT NULL,
  skill    text   NOT NULL CHECK (char_length(skill) BETWEEN 1 AND 40),
  position int    NOT NULL,
  PRIMARY KEY (user_id, skill)
);
-- One spelling per tag per person: the PK alone lets "Go" and "go" both in.
CREATE UNIQUE INDEX ux_user_skills ON user_skills (user_id, lower(skill));

-- ---------------------------------------------------------------------------
-- Projects, boards, lists, cards
-- Nothing is hard-deleted: archived_at / deleted_at hide rows. Foreign keys
-- keep the default ON DELETE NO ACTION, so an accidental DELETE fails instead
-- of cascading. Join rows (members, assignees, card labels, mentions, shares)
-- are the exception: the service deletes those rows explicitly.
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  owner_id    bigint      NOT NULL,
  -- The work state. Whether it is archived is archived_at alone.
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'done')),
  start_date  date        NULL,
  end_date    date        NULL,
  created_by  bigint      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
-- Names are unique ignoring case among live projects; an archived one's name
-- can be reused.
CREATE UNIQUE INDEX ux_projects_name ON projects (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE project_members (
  project_id bigint      NOT NULL REFERENCES projects (id),
  user_id    bigint      NOT NULL,
  role       text        NOT NULL CHECK (role IN ('pm', 'member', 'viewer')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
-- "My projects" and every permission check.
CREATE INDEX idx_project_members_user ON project_members (user_id);

-- One board per project. updated_at is the board's ETag: every write that
-- changes what the board shows bumps it in the same transaction.
CREATE TABLE boards (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint      NOT NULL UNIQUE REFERENCES projects (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- position is a LexoRank key compared bytewise: COLLATE "C" on the column,
-- so every ORDER BY position and the unique index sort the same way.
CREATE TABLE lists (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    bigint      NOT NULL REFERENCES boards (id),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  position    text        COLLATE "C" NOT NULL,
  is_done     boolean     NOT NULL DEFAULT false,
  wip_limit   int         NULL CHECK (wip_limit > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);
-- Board load and order. Archived rows keep their old key, so they are left
-- out: a new key between visible neighbours could collide with one.
CREATE UNIQUE INDEX ux_lists_position ON lists (board_id, position) WHERE archived_at IS NULL;

CREATE TABLE cards (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  list_id        bigint      NOT NULL REFERENCES lists (id),
  title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description_md text        NOT NULL DEFAULT '' CHECK (char_length(description_md) <= 20000),
  -- 0 low, 1 medium, 2 high, 3 urgent; ordered, so ORDER BY priority DESC works.
  priority       smallint    NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 3),
  start_date     date        NULL,
  due_date       date        NULL,
  position       text        COLLATE "C" NOT NULL,
  created_by     bigint      NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when the card moves into an is_done list, cleared when it moves out.
  completed_at   timestamptz NULL,
  -- Bumped by every write to the card or its children.
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz NULL,
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
-- Board load, order and the LexoRank gap (idx_cards_list in the contract).
CREATE UNIQUE INDEX ux_cards_position ON cards (list_id, position) WHERE archived_at IS NULL;
-- Overdue / due soon on the dashboard.
CREATE INDEX idx_cards_due ON cards (due_date) WHERE archived_at IS NULL AND completed_at IS NULL;

CREATE TABLE card_assignees (
  card_id     bigint      NOT NULL REFERENCES cards (id),
  user_id     bigint      NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, user_id)
);
-- My Tasks and workload.
CREATE INDEX idx_card_assignees_user ON card_assignees (user_id);

CREATE TABLE labels (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects (id),
  name       text   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color      text   NOT NULL CHECK (color IN ('green', 'yellow', 'red', 'blue', 'purple', 'gray'))
);
CREATE UNIQUE INDEX ux_labels_name ON labels (project_id, lower(name));

-- The label must belong to the card's own project: the service checks it,
-- since cards carry no project_id.
CREATE TABLE card_labels (
  card_id  bigint NOT NULL REFERENCES cards (id),
  label_id bigint NOT NULL REFERENCES labels (id),
  PRIMARY KEY (card_id, label_id)
);
-- Deleting a label first deletes its card_labels rows by label_id.
CREATE INDEX idx_card_labels_label ON card_labels (label_id);

-- No archive, so the unique position index covers every item.
CREATE TABLE checklist_items (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id    bigint      NOT NULL REFERENCES cards (id),
  text       text        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  is_done    boolean     NOT NULL DEFAULT false,
  position   text        COLLATE "C" NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Also serves "items of a card" (idx_checklist_card in the contract).
CREATE UNIQUE INDEX ux_checklist_position ON checklist_items (card_id, position);

CREATE TABLE comments (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id    bigint      NOT NULL REFERENCES cards (id),
  author_id  bigint      NOT NULL,
  body_md    text        NOT NULL CHECK (char_length(body_md) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz NULL,
  deleted_at timestamptz NULL
);
CREATE INDEX idx_comments_card ON comments (card_id) WHERE deleted_at IS NULL;

CREATE TABLE comment_mentions (
  comment_id bigint NOT NULL REFERENCES comments (id),
  user_id    bigint NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Reports
-- Files never go in the database: only their metadata and blob key.
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint      NOT NULL REFERENCES projects (id),
  storage_key text        NOT NULL UNIQUE,
  filename    text        NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  mime_type   text        NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes  bigint      NOT NULL CHECK (size_bytes >= 0),
  uploaded_by bigint      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);
CREATE INDEX idx_documents_project ON documents (project_id, created_at DESC) WHERE deleted_at IS NULL;

-- A project's report folder shared with someone outside the project: the
-- folder only (list, download, upload, delete own uploads), never the board.
CREATE TABLE folder_shares (
  project_id bigint      NOT NULL REFERENCES projects (id),
  user_id    bigint      NOT NULL,
  shared_by  bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
-- The caller's folder list.
CREATE INDEX idx_folder_shares_user ON folder_shares (user_id);

-- Department-wide report templates (no project).
CREATE TABLE report_templates (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category    text        NOT NULL CHECK (char_length(category) BETWEEN 1 AND 60),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  storage_key text        NOT NULL UNIQUE,
  filename    text        NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  mime_type   text        NOT NULL,
  size_bytes  bigint      NOT NULL CHECK (size_bytes >= 0),
  uploaded_by bigint      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);
-- Reports > Templates list, by category then name.
CREATE INDEX idx_report_templates_live ON report_templates (lower(category), lower(name), id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Activity log: kept forever, partitioned by month on created_at. A
-- partitioned table needs the partition key in its primary key. The id comes
-- from a plain sequence, which works the same on every partition.
-- payload holds only ids and changed values, never names or snapshots.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE activity_events_id_seq AS bigint;

CREATE TABLE activity_events (
  id         bigint      NOT NULL DEFAULT nextval('activity_events_id_seq'),
  project_id bigint      NOT NULL REFERENCES projects (id),
  card_id    bigint      NULL REFERENCES cards (id),
  actor_id   bigint      NOT NULL,
  type       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

ALTER SEQUENCE activity_events_id_seq OWNED BY activity_events.id;

-- Created on every partition automatically.
CREATE INDEX idx_activity_project ON activity_events (project_id, created_at DESC);

-- Creates the month's partition if it does not exist. Run it ahead of time
-- for coming months (the worker will do this once it exists).
CREATE FUNCTION ensure_activity_partition(month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  from_day date := date_trunc('month', month)::date;
  name     text := format('activity_events_%s', to_char(from_day, 'YYYY_MM'));
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS tracking.%I PARTITION OF tracking.activity_events FOR VALUES FROM (%L) TO (%L)',
    name, from_day, (from_day + interval '1 month')::date);
END
$$;

-- This month and the next 12.
SELECT ensure_activity_partition((date_trunc('month', current_date) + make_interval(months => m))::date)
FROM generate_series(0, 12) AS m;

-- Rows outside every monthly partition land here instead of failing the
-- write. It should stay empty: if it is not, a month's partition is missing.
CREATE TABLE activity_events_default PARTITION OF activity_events DEFAULT;

-- ---------------------------------------------------------------------------
-- What the service may do: read and write rows, never change the schema.
-- Migrations (and ensure_activity_partition, which creates tables) run as the
-- owner of the schema, not as tracking_app.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA tracking TO tracking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tracking TO tracking_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tracking TO tracking_app;
-- Tables and sequences a later migration creates get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA tracking GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tracking_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA tracking GRANT USAGE, SELECT ON SEQUENCES TO tracking_app;

COMMIT;
