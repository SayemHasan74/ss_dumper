CREATE TABLE files (
  id          TEXT PRIMARY KEY,                 -- ULID (sorts by creation time)
  name        TEXT NOT NULL,                    -- original filename, sanitized, max 200 chars
  mime        TEXT NOT NULL,                    -- server-sniffed type, never client-claimed
  size        INTEGER NOT NULL,                 -- bytes of original
  sha256      TEXT,                             -- lowercase hex, nullable
  width       INTEGER,
  height      INTEGER,
  thumb_size  INTEGER NOT NULL DEFAULT 0,       -- 0 = thumbnail not generated yet
  note        TEXT NOT NULL DEFAULT '',         -- max 280 chars
  pinned      INTEGER NOT NULL DEFAULT 0,       -- 1 = exempt from auto-expire
  created_at  INTEGER NOT NULL,                 -- epoch ms UTC
  deleted_at  INTEGER                           -- NULL = active, value = in Trash
);
CREATE INDEX idx_files_active ON files(id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_trash  ON files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX idx_files_sha_active ON files(sha256) WHERE sha256 IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE file_tags (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,                        -- lowercase [a-z0-9-], 1-24 chars, max 5 per file
  PRIMARY KEY (file_id, tag)
);
CREATE INDEX idx_file_tags_tag ON file_tags(tag, file_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('auto_expire_days', '30'),   -- 0 = never
  ('trash_days', '7'),
  ('session_epoch', '1');

CREATE TABLE login_attempts (
  ip_hash      TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL,
  window_start INTEGER NOT NULL                 -- epoch ms
);
