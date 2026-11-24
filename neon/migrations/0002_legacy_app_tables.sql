-- Neon/PostgreSQL schema for the app's profiles, community, passkeys and history data.
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  archive_user TEXT NOT NULL DEFAULT '',
  agreed_at BIGINT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  webauthn_user TEXT,
  handle TEXT
);
CREATE UNIQUE INDEX profiles_handle ON profiles (LOWER(handle)) WHERE handle IS NOT NULL;

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unlisted',
  submitted_at BIGINT,
  featured_at BIGINT,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL
);
CREATE INDEX channels_profile ON channels(profile_id);
CREATE INDEX channels_status ON channels(status);

CREATE TABLE channel_films (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  film_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  flagged INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, film_id)
);

CREATE TABLE favourites (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  film_id TEXT NOT NULL,
  created BIGINT NOT NULL,
  PRIMARY KEY (profile_id, film_id)
);

CREATE TABLE channel_saves (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created BIGINT NOT NULL,
  PRIMARY KEY (profile_id, channel_id)
);
CREATE INDEX channel_saves_channel ON channel_saves(channel_id);

CREATE TABLE limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  until BIGINT NOT NULL
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL
);
CREATE INDEX passkeys_profile ON passkeys(profile_id);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  profile_id TEXT,
  until BIGINT NOT NULL
);

CREATE TABLE handle_holds (
  handle TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  until BIGINT NOT NULL
);

CREATE TABLE history (
  id BIGSERIAL PRIMARY KEY,
  at BIGINT NOT NULL,
  kind TEXT NOT NULL,
  profile_id TEXT,
  channel_id TEXT,
  net TEXT,
  detail TEXT
);
CREATE INDEX history_at ON history(at);
CREATE INDEX history_profile ON history(profile_id);
CREATE INDEX history_net ON history(net, at);
CREATE INDEX history_kind ON history(kind, at);

CREATE TABLE feedback (
  id BIGSERIAL PRIMARY KEY,
  at BIGINT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  page TEXT
);
CREATE INDEX feedback_at ON feedback(at);
