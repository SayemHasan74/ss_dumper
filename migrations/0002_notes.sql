CREATE TABLE notes_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
INSERT INTO notes_state (id, revision) VALUES (1, 0);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT '0',
  chunks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE note_chunks (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  staged_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, version, position)
);
CREATE INDEX idx_note_chunks_age ON note_chunks(staged_at);
CREATE TRIGGER notes_insert AFTER INSERT ON notes BEGIN
  UPDATE notes_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER notes_update AFTER UPDATE ON notes BEGIN
  UPDATE notes_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER notes_delete AFTER DELETE ON notes BEGIN
  UPDATE notes_state SET revision = revision + 1 WHERE id = 1;
END;
