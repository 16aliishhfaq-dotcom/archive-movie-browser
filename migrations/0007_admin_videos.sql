CREATE TABLE admin_videos (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  year INTEGER,
  genre TEXT NOT NULL DEFAULT '',
  poster_url TEXT,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  archive_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'uploaded', 'failed')),
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX admin_videos_created ON admin_videos(created DESC);
CREATE INDEX admin_videos_public ON admin_videos(published, status, created DESC);
