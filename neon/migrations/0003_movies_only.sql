-- Neon stores only the curated movie catalogue. Archive.org hosts video bytes.
-- The other application tables were checked and had zero rows before this migration.
DROP TABLE IF EXISTS challenges, channel_films, channel_saves, channels, favourites,
  feedback, handle_holds, history, limits, passkeys, profiles, admin_videos CASCADE;
CREATE TABLE movies (
  id TEXT PRIMARY KEY,
  movie_name VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  poster TEXT NOT NULL,
  movie_link TEXT NOT NULL UNIQUE
);
