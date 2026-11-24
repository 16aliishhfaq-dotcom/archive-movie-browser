# Archive.org curation dashboard

The private admin area lives at /admin. It does not upload, copy, or modify video files. An admin pastes an Archive.org item URL or identifier; the Worker reads the item's official metadata and file list from Archive.org, validates it, then stores a small catalogue entry in the site's own D1 database.

## What happens when a visitor watches

The public listing links to /browse#<identifier>. The existing browser opens the item using its Archive.org metadata, its existing playable MP4/M4V files and the site's own player. If the browser cannot play the item's files, the existing Archive.org embedded player is used. Video bytes remain hosted by Archive.org.

## Required Worker secrets

Set the admin credentials on your own Cloudflare Worker (never use a VITE_ prefix):

- ADMIN_PASSWORD — a strong, unique dashboard password.
- ADMIN_SESSION_SECRET — a random secret of at least 32 characters.

The login uses a signed HttpOnly, Secure, SameSite=Strict cookie. No Archive.org upload credentials are required.

## Database

This feature adds migrations/0007_admin_videos.sql. First make sure DB in wrangler.jsonc is your own D1 database, then run:

npx wrangler d1 migrations apply orphanedfilms --remote

Do not apply this against the original upstream database ID. The inherited wrangler.jsonc currently contains the upstream database ID and upstream domain routes. Create your own D1 database, replace database_id, set a Worker name and domain that belong to your account, and only then run the migration.

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

Before an item can be curated, it must be an Archive.org details/embed URL or identifier, exist on Archive.org, be catalogued as mediatype=movies, contain a supported video file, and pass the site's takedown/content-policy checks. Each item is fetched and checked again when it is added, so the admin preview is not trusted as the final record.
