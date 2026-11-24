-- Project Tracking: one-time database setup, run by a DBA (or you, locally)
-- as a superuser such as "postgres". It makes the login role and the empty
-- schema; tracking-service creates and upgrades the tables itself at start-up
-- (goose migrations in internal/store/postgres/migrations).
--
-- How to run in pgAdmin:
--   1. Servers > your server > Databases > right-click > Create > Database...
--      Name: tracking, Owner: postgres. Save.
--   2. Select the new "tracking" database, then Tools > Query Tool.
--   3. Open this file (folder icon) or paste it, and run it (F5).
--   4. In the same Query Tool, give the role a password (keep it out of git):
--        ALTER ROLE tracking_app PASSWORD 'choose-a-password';
--   5. Point the service at it, in backend/.env.local or the environment:
--        DATABASE_URL=postgres://tracking_app:choose-a-password@127.0.0.1:5432/tracking
--
-- Safe to run again: every step checks first.
--
-- tracking_app owns the schema, so it can apply migrations. A stricter set-up
-- (a separate owner role for migrations and a read/write-only role for the
-- service) can come later without changing the tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracking_app') THEN
    CREATE ROLE tracking_app LOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS tracking AUTHORIZATION tracking_app;

-- The service may not touch anything outside its schema in this database.
REVOKE CREATE ON SCHEMA public FROM tracking_app;

DO $$
BEGIN
  -- The services compute "today" in Go (Asia/Bangkok) and never use
  -- current_date; this is a safety net so any SQL that does gets the Thai day,
  -- not the UTC one (which is still yesterday until 07:00 Thai time). It
  -- applies to this role in this database only.
  EXECUTE format('ALTER ROLE tracking_app IN DATABASE %I SET timezone = %L', current_database(), 'Asia/Bangkok');
  EXECUTE format('ALTER ROLE tracking_app IN DATABASE %I SET search_path = tracking', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tracking_app', current_database());
END
$$;
