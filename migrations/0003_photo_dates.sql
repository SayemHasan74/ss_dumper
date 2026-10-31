ALTER TABLE files ADD COLUMN photo_date INTEGER;
ALTER TABLE files ADD COLUMN photo_date_source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE files ADD COLUMN photo_timezone_assumed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_files_photo_active ON files(COALESCE(photo_date, created_at) DESC, id DESC) WHERE deleted_at IS NULL;
