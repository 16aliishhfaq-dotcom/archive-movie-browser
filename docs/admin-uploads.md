# Archive.org curation dashboard

The private admin area lives at /admin. It does not upload, copy, or modify video files. An admin pastes an Archive.org item URL or identifier; the Worker reads the item's official metadata and file list, validates it, then stores a small catalogue entry in Neon Postgres. Archive.org remains the video host.

## What happens when a visitor watches

The public listing links to /browse#<identifier>. The existing browser opens the item using its Archive.org metadata, its playable video files and the site's own player. If the browser cannot play the item's files, the existing Archive.org embedded player is used. Video bytes remain hosted by Archive.org.

## Data services

- Neon Postgres stores the admin-curated Archive.org catalogue.
- Upstash Redis is an optional cache for the public catalogue and a distributed admin-login rate limit. Without Redis, the dashboard falls back to uncached reads and per-Worker-instance rate limiting.
- The rest of the existing application (profiles, channels, favourites, passkeys, history and community limits) still uses Cloudflare D1. This is a scoped database migration, not a claim that every legacy table has moved to Neon.

The application uses the pooled Neon DATABASE_URL for request traffic. Keep it server-side; never prefix it with VITE_.

## Worker secrets

Set these secrets on the Cloudflare Worker that runs worker.js:

- DATABASE_URL — Neon pooled PostgreSQL connection string.
- ADMIN_PASSWORD — strong, unique dashboard password.
- ADMIN_SESSION_SECRET — random secret of at least 32 characters.
- UPSTASH_REDIS_REST_URL — Upstash Redis REST endpoint.
- UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST write token.
- UPSTASH_REDIS_REST_READ_ONLY_TOKEN — optional read-only token; the write token is used for reads if omitted.

Use Wrangler's `npx wrangler secret put <NAME>` command for each value. Existing KV_REST_API_* environment names remain supported by the shared Redis helper for the older analytics system.

The admin login uses a signed HttpOnly, Secure, SameSite=Strict cookie. No Archive.org upload credentials are required.

## Neon database

The production Neon project already has public.admin_videos, with unique item identifiers and indexes for newest-first and published-list queries. The migration source is neon/migrations/0001_admin_videos.sql. It was tested on a temporary Neon branch, schema-inspected and smoke-tested (draft, publish/read, and delete) before being applied to the production branch.

Do not apply the Neon migration to the upstream owner's D1 database.

## Admin routes

- POST /api/admin/session — password login.
- GET /api/admin/session — validate the session.
- POST /api/admin/logout — clear the session.
- GET /api/admin/archive-preview?item=<identifier-or-url> — preview/validate an Archive.org item.
- GET /api/admin/videos — list curated items (admin only).
- POST /api/admin/videos — re-fetch metadata and add an Archive.org item as a draft.
- PATCH /api/admin/videos/:id — edit local display metadata and publish/unpublish.
- DELETE /api/admin/videos/:id — remove the site's catalogue entry only; it never deletes the Archive.org item.
- GET /api/uploads — public list of published items.

## Checks

Before an item can be curated, it must be an Archive.org details/embed URL or identifier, exist on Archive.org, be catalogued as mediatype=movies, contain a supported video file, and pass the existing takedown/content-policy checks. The Worker fetches and checks it again when the item is added, so the earlier preview is not trusted as the final record.