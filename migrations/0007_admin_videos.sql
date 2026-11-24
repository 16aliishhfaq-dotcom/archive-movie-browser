CREATE TABLE admin_videos (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  year INTEGER,
  genre TEXT NOT NULL DEFAULT '',
  poster_url TEXT,
  archive_url TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT '',
  video_files INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX admin_videos_created ON admin_videos(created DESC);
CREATE INDEX admin_videos_public ON admin_videos(published, created DESC);
