-- FUXA project storage, PostgreSQL schema (idempotent, run on every init)
-- Same tables as the SQLite project.fuxap.db, see docs/storage-schema.md
--  value: JSON (not JSONB) keeps the stored text byte for byte (key order) and validates it
--  seq:   renewed on every write, reads are ORDER BY seq like the SQLite rowid order after INSERT OR REPLACE
-- The tables are created in the first schema of the search_path (settings.storage.postgres.schema, default public)

CREATE SEQUENCE IF NOT EXISTS prjstorage_seq;

CREATE TABLE IF NOT EXISTS general (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS views (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS devices (name TEXT PRIMARY KEY, value JSON, connection TEXT, cntid TEXT, cntpwd TEXT, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS devicesSecurity (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS texts (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS alarms (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS recipes (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS notifications (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS scripts (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS reports (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS locations (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
CREATE TABLE IF NOT EXISTS arMarkers (name TEXT PRIMARY KEY, value JSON, seq BIGINT NOT NULL DEFAULT nextval('prjstorage_seq'));
