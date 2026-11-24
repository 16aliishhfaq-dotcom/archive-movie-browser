# Movie catalogue: Neon + Redis + Archive.org

The private admin dashboard is at `/admin`. It does not upload, copy or modify video files. Paste an Archive.org item identifier or details URL; the Worker verifies the official metadata and video file, then stores only the five requested fields in Neon.

## Neon schema

The live Neon database contains exactly one application table:

```sql
CREATE TABLE movies (
  id TEXT PRIMARY KEY,
  movie_name VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  poster TEXT NOT NULL,
  movie_link TEXT NOT NULL UNIQUE
);
```

No description, year, publish state, timestamps, file sizes, profiles, channels, favourites, history or other application records are stored in Neon. Every row is public in the curated catalogue. The old application tables were checked and contained zero rows before they were removed. Migration `0003_movies_only.sql` drops those old empty tables and creates the single `movies` table.

## Redis cache

Upstash Redis is used for caching only:
- Public movie list: 5-minute TTL.
- Archive.org metadata preview: 5-minute TTL.
- Cache invalidation after movie add, edit or removal.

Admin dashboard checks Redis with `PING` and displays the actual connection status. If Redis credentials are missing or the service is unavailable, the app falls back to Neon reads; it does not claim Redis is connected.

Set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and optionally `UPSTASH_REDIS_REST_READ_ONLY_TOKEN` as Cloudflare Worker secrets. Legacy `KV_REST_API_*` names remain accepted. Redis is not used as a second database, analytics store, or login-rate-limit store.

## Required Worker secrets

- `DATABASE_URL`: Neon pooled connection string.
- `ADMIN_PASSWORD`: strong admin password.
- `ADMIN_SESSION_SECRET`: random secret, at least 32 characters.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: Upstash REST credentials.
- Optional `UPSTASH_REDIS_REST_READ_ONLY_TOKEN`.

Set them with `npx wrangler secret put <NAME>`. Never commit credentials or use `VITE_` prefixes.

## Admin API

- `POST /api/admin/session`, `GET /api/admin/session`, `POST /api/admin/logout`
- `GET /api/admin/archive-preview?item=<Archive.org identifier or URL>`
- `GET /api/admin/movies`, `POST /api/admin/movies`
- `PATCH /api/admin/movies/:id`, `DELETE /api/admin/movies/:id`
- `GET /api/admin/cache` (admin-only Redis connection status)
- `GET /api/uploads` (public movie catalogue)

Community/profile/passkey/history and analytics endpoints are disabled because Neon is intentionally reserved for the one-table movie catalogue. Redis is reserved for caching only.
