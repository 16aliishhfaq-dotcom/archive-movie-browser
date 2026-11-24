# Admin video uploads

The private dashboard is at /admin. Video bytes are streamed through your Cloudflare Worker to Internet Archive. Archive keys and the admin password remain server-side only.

## Before deployment

The inherited wrangler.jsonc still references the upstream D1 database ID and upstream production domain routes. Create your own D1 database, replace database_id in wrangler.jsonc, choose a Worker name and domain belonging to your account, and verify all resource settings before running any remote migration or deploy. Do not deploy against resources you do not own.

## Worker secrets

Set ADMIN_PASSWORD, ADMIN_SESSION_SECRET, IA_S3_ACCESS_KEY and IA_S3_SECRET_KEY using wrangler secret put. ADMIN_SESSION_SECRET must be random and at least 32 characters. IA S3 credentials come from your own Internet Archive account. Optionally set IA_COLLECTION only to a collection you can write to.

## Database migration

After DB is bound to your own D1 database, run: npx wrangler d1 migrations apply orphanedfilms --remote

## Upload size

The first version streams each upload and caps it at 95 MiB. Cloudflare documents a 100 MB incoming body limit for Free and Pro zones. Larger feature-length files need a dedicated resumable or multipart upload service; changing the browser file selector limit cannot bypass the edge request limit.

## Routes

- POST /api/admin/session — password login; sets a 12-hour signed HttpOnly, Secure, SameSite=Strict session cookie.
- GET /api/admin/session — validate the current token.
- GET /api/admin/videos — private upload list.
- POST /api/admin/upload — upload raw video bytes to Archive.org.
- PATCH /api/admin/videos/:id — update metadata and publish/draft status.
- GET /api/uploads — public list of published uploads.

All uploads begin as drafts. Publish after reviewing details. The /admin route is intentionally not linked in public navigation.