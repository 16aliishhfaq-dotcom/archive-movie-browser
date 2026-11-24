# Neon + Upstash backend and Archive.org video curation

The private admin dashboard lives at `/admin`. It does not upload, copy, or modify video files. An admin pastes an Archive.org item URL or identifier; the Worker reads the official metadata and file list, validates it, and stores a catalogue entry in Neon Postgres. Archive.org remains the video host.

## Video playback

Published catalogue cards open `/browse#<identifier>`. The existing browser loads the Archive.org item and uses the site's player with Archive.org-hosted video files; it falls back to the Archive.org embedded player when required. Video bytes are never stored in Neon or Redis.

## Database architecture

Neon Postgres is the application's relational database for:

- Admin video catalogue and publish state.
- Profiles, channels, channel films, favourites and saved channels.
- Passkeys, challenges and handle reservations.
- Community rate limits, history and feedback.

`api/_neon-db.js` adapts the project's existing D1-style prepared-statement interface to Neon's serverless Postgres driver. It translates the SQLite-specific statements used by the app and uses Neon HTTP transactions for `batch()` operations. The legacy `migrations/*.sql` files are retained as historical SQLite/D1 schema references; the live Neon schema is defined in `neon/migrations/`.

## Redis

Upstash Redis is wired as an optional shared cache and rate-limit service:

- Public curated-film listing cache (short TTL, invalidated after admin edits).
- Distributed admin-login rate limiting.
- Existing usage analytics and community lookups use the shared Redis REST helper.

The repository supports `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and optional `UPSTASH_REDIS_REST_READ_ONLY_TOKEN`. Older `KV_REST_API_*` names remain accepted for compatibility. If Redis credentials are absent, the dashboard falls back to uncached Neon reads and per-Worker-instance login throttling; analytics requests may not be recorded until Redis is configured.

Create an Upstash Redis database in AWS `us-east-2` to align with the Neon project's region, then set its REST URL and tokens as Worker secrets. Do not paste tokens into source code or commit them.

## Cloudflare Worker secrets

Configure these values on the Cloudflare Worker that serves `worker.js`:

- `DATABASE_URL` — Neon pooled PostgreSQL connection string.
- `ADMIN_PASSWORD` — a strong, unique dashboard password.
- `ADMIN_SESSION_SECRET` — a random secret of at least 32 characters.
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST endpoint.
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis write token.
- `UPSTASH_REDIS_REST_READ_ONLY_TOKEN` — optional read-only token.
- `STATS_TOKEN`, `NET_SALT`, and `TURNSTILE_SECRET` where the existing app features require them.

Set secrets with `npx wrangler secret put <NAME>`. Keep all secrets server-side; never prefix them with `VITE_`.

## Neon migrations

The Neon project is `muddy-water-69331457`, default branch `br-soft-wave-bexn6hpf`, database `neondb`. The schema is created by:

- `neon/migrations/0001_admin_videos.sql` — curated Archive.org video catalogue.
- `neon/migrations/0002_legacy_app_tables.sql` — profiles, community, passkeys, history, feedback and associated indexes.

Both migrations are prepared and validated on temporary Neon branches before being applied to the production branch. The production schema does not import rows from the upstream owner's D1 database; this fork gets its own isolated Neon tables.

## Admin API

- `POST /api/admin/session` — password login.
- `GET /api/admin/session` — validate session.
- `POST /api/admin/logout` — clear session.
- `GET /api/admin/archive-preview?item=<identifier-or-url>` — preview an Archive.org item.
- `GET /api/admin/videos` — list curated items (admin only).
- `POST /api/admin/videos` — re-fetch metadata and add an item as a draft.
- `PATCH /api/admin/videos/:id` — edit site-local display metadata and publish/unpublish.
- `DELETE /api/admin/videos/:id` — remove only the site's catalogue row; the Archive.org item is untouched.
- `GET /api/uploads` — public list of published items.

## Validation

Admin accepts only Archive.org details/embed URLs or item identifiers. The Worker re-fetches and validates the item on add, verifies `mediatype=movies`, checks for a supported video file, and applies the existing takedown/content policy before publishing. Drafts are hidden from the website, but Archive.org item visibility is controlled by Archive.org, not by this site's draft flag.