CREATE TABLE admin_videos (
  id TEXT PRIMARY KEY,
  identifier VARCHAR(200) NOT NULL UNIQUE,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  year SMALLINT CHECK (year IS NULL OR year BETWEEN 1880 AND 2100),
  genre VARCHAR(120) NOT NULL DEFAULT '',
  poster_url TEXT,
  archive_url TEXT NOT NULL,
  runtime VARCHAR(40) NOT NULL DEFAULT '',
  video_files INTEGER NOT NULL DEFAULT 0 CHECK (video_files >= 0),
  file_size BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL
);
CREATE INDEX admin_videos_created_idx ON admin_videos (created DESC);
CREATE INDEX admin_videos_public_idx ON admin_videos (published, created DESC);
