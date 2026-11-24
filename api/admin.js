// Curate existing Archive.org items. Video files always stay on Archive.org.
import { neon } from '@neondatabase/serverless';
import { redis } from './_redis.js';
import { normalizeArchiveItem, parseArchiveIdentifier } from '../src/services/adminArchive.js';
import { isForbidden, isTakenDown } from '../src/services/policy.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const PUBLIC_CACHE_KEY = 'orphanedfilms:admin:public:v1';
const attempts = new Map();
const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  },
});
const empty = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const b64u = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const unb64u = value => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const clean = (value, max) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const randomHex = length => [...crypto.getRandomValues(new Uint8Array(length))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

function sameSite(request) {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (site && site !== 'same-origin') return false;
  if (origin) {
    try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
  }
  return site === 'same-origin';
}

// Builds a genuine tagged-template call so every value is still a Neon query parameter.
function statement(sql, text, values = []) {
  const strings = [];
  const parameters = [];
  const matcher = /\$(\d+)/g;
  let offset = 0;
  let match;
  while ((match = matcher.exec(text))) {
    strings.push(text.slice(offset, match.index));
    parameters.push(values[Number(match[1]) - 1]);
    offset = matcher.lastIndex;
  }
  strings.push(text.slice(offset));
  strings.raw = strings.slice();
  return sql(strings, ...parameters);
}

function database(env) {
  if (typeof env.NEON_CLIENT === 'function') return env.NEON_CLIENT;
  if (!env.DATABASE_URL) throw new Error('Neon is not configured. Set the DATABASE_URL Worker secret.');
  return neon(env.DATABASE_URL);
}

function redisConfigured(env) {
  return !!((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL) &&
    (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN));
}

async function cacheGet(env, key) {
  if (!redisConfigured(env)) return null;
  try {
    const [value] = await redis([['GET', key]], { readOnly: true, env });
    if (typeof value !== 'string') return value ?? null;
    try { return JSON.parse(value); } catch { return null; }
  } catch {
    return null;
  }
}

async function cacheSet(env, key, value, seconds) {
  if (!redisConfigured(env)) return;
  try { await redis([['SET', key, JSON.stringify(value), 'EX', seconds]], { env }); } catch { /* Redis is an optional cache */ }
}

async function cacheDelete(env, key) {
  if (!redisConfigured(env)) return;
  try { await redis([['DEL', key]], { env }); } catch { /* the next read will rebuild the cache */ }
}

async function hashHex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function overLimit(key, max, windowMs) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.until <= now) {
    attempts.set(key, { count: 1, until: now + windowMs });
    if (attempts.size > 2000) {
      for (const [name, value] of attempts) if (value.until <= now) attempts.delete(name);
    }
    return false;
  }
  current.count += 1;
  return current.count > max;
}

async function loginOverLimit(env, ip) {
  if (!redisConfigured(env)) return { blocked: overLimit('login:' + ip, 8, LOGIN_WINDOW_SECONDS * 1000), key: null };
  const key = 'orphanedfilms:admin:login:' + (await hashHex(ip)).slice(0, 32);
  try {
    const results = await redis([['INCR', key], ['EXPIRE', key, LOGIN_WINDOW_SECONDS]], { env });
    return { blocked: Number(results[0]) > 8, key };
  } catch {
    return { blocked: overLimit('login:' + ip, 8, LOGIN_WINDOW_SECONDS * 1000), key: null };
  }
}

async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 16_384) return { error: 413 };
  const body = await request.text();
  if (body.length > 16_384) return { error: 413 };
  try { return { body: body ? JSON.parse(body) : {} }; } catch { return { error: 400 }; }
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function issueSession(secret) {
  const payload = b64u(encoder.encode(JSON.stringify({ sub: 'admin', exp: Date.now() + SESSION_MS })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(secret), encoder.encode(payload)));
  return payload + '.' + b64u(signature);
}
async function validSession(request, secret) {
  if (!secret || secret.length < 32) return false;
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith('of_admin='))?.slice('of_admin='.length) || '';
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  try {
    if (!await crypto.subtle.verify('HMAC', await sessionKey(secret), unb64u(signature), encoder.encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return data.sub === 'admin' && Number.isFinite(data.exp) && data.exp > Date.now();
  } catch { return false; }
}
async function passwordMatches(supplied, expected) {
  if (typeof supplied !== 'string' || supplied.length > 1024) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function record(row) {
  return {
    id: row.id, identifier: row.identifier, title: row.title, description: row.description || '',
    year: row.year, genre: row.genre || '', poster_url: row.poster_url, archive_url: row.archive_url,
    runtime: row.runtime || '', video_files: Number(row.video_files) || 0,
    file_size: Number(row.file_size) || 0, published: row.published === true || row.published === 1,
    created: Number(row.created), updated: Number(row.updated),
  };
}

async function fetchArchiveItem(identifier, env, { fresh = false } = {}) {
  const key = 'orphanedfilms:archive:item:' + identifier;
  if (!fresh) {
    const cached = await cacheGet(env, key);
    if (cached?.identifier === identifier &&
        !isTakenDown(identifier) &&
        !isForbidden({ title: cached.title, description: cached.description, subject: cached.genre })) return cached;
  }
  const response = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier), {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Archive.org could not find that item.');
    throw new Error('Archive.org is temporarily unavailable. Try again in a moment.');
  }
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('Archive.org returned an unreadable metadata response.');
  const item = normalizeArchiveItem(payload, identifier);
  await cacheSet(env, key, item, 300);
  return item;
}

async function signIn(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    return json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD and a random ADMIN_SESSION_SECRET of at least 32 characters.' }, 503);
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const limiter = await loginOverLimit(env, ip);
  if (limiter.blocked) return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  if (!await passwordMatches(parsed.body?.password, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password.' }, 401);
  attempts.delete('login:' + ip);
  if (limiter.key) await cacheDelete(env, limiter.key);
  const token = await issueSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': 'of_admin=' + token + '; Path=/; Max-Age=' + (SESSION_MS / 1000) + '; HttpOnly; Secure; SameSite=Strict',
  });
}

async function previewItem(request, env) {
  if (request.method !== 'GET') return empty(405);
  let identifier;
  try { identifier = parseArchiveIdentifier(new URL(request.url).searchParams.get('item')); }
  catch (error) { return json({ error: error.message }, 400); }
  try { return json({ item: await fetchArchiveItem(identifier, env) }); }
  catch (error) { return json({ error: clean(error?.message || 'Could not read this Archive.org item.', 300) }, 422); }
}

async function addItem(request, env, sql) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  let identifier;
  try { identifier = parseArchiveIdentifier(parsed.body?.item); }
  catch (error) { return json({ error: error.message }, 400); }
  try {
    // Do not trust the earlier preview: retrieve and validate the item again before saving it.
    const item = await fetchArchiveItem(identifier, env, { fresh: true });
    const id = randomHex(12), now = Date.now();
    const [row] = await statement(sql,
      'INSERT INTO admin_videos (id, identifier, title, description, year, genre, poster_url, archive_url, runtime, video_files, file_size, published, created, updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, $12, $13) ON CONFLICT (identifier) DO NOTHING RETURNING *',
      [id, item.identifier, item.title, item.description, item.year, item.genre, item.poster_url,
        item.archive_url, item.runtime, item.video_files, item.file_size, now, now]);
    if (!row) return json({ error: 'This Archive.org item is already in your site library.' }, 409);
    await cacheDelete(env, PUBLIC_CACHE_KEY);
    return json({ video: record(row) }, 201);
  } catch (error) {
    if (String(error?.message || '').includes('unique constraint')) return json({ error: 'This Archive.org item is already in your site library.' }, 409);
    return json({ error: clean(error?.message || 'Could not add this Archive.org item.', 300) }, 422);
  }
}

async function updateItem(request, env, id, sql) {
  if (!['PATCH', 'DELETE'].includes(request.method)) return empty(405);
  if (!sameSite(request)) return empty(403);
  const [current] = await statement(sql, 'SELECT * FROM admin_videos WHERE id = $1 LIMIT 1', [id]);
  if (!current) return empty(404);
  if (request.method === 'DELETE') {
    await statement(sql, 'DELETE FROM admin_videos WHERE id = $1', [id]);
    await cacheDelete(env, PUBLIC_CACHE_KEY);
    return json({ ok: true, removed_from_site: current.identifier });
  }
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  const body = parsed.body || {};
  const title = body.title === undefined ? current.title : clean(body.title, 180);
  const description = body.description === undefined ? current.description : clean(body.description, 2000);
  const genre = body.genre === undefined ? current.genre : clean(body.genre, 120);
  const year = body.year === undefined ? current.year : (body.year === '' || body.year === null ? null : Number(body.year));
  const posterUrl = body.poster_url === undefined ? current.poster_url : clean(body.poster_url, 500);
  const published = body.published === undefined ? (current.published === true || current.published === 1) : !!body.published;
  if (!title) return json({ error: 'Title cannot be empty.' }, 400);
  if (published && (isTakenDown(current.identifier) || isForbidden({ title, description, subject: genre }))) {
    return json({ error: 'This item cannot be published because it conflicts with the website content/takedown policy.' }, 400);
  }
  if (year !== null && (!Number.isInteger(year) || year < 1880 || year > 2100)) return json({ error: 'Enter a valid year between 1880 and 2100.' }, 400);
  if (posterUrl) {
    try { if (new URL(posterUrl).protocol !== 'https:') throw new Error(); }
    catch { return json({ error: 'Poster URL must be a valid HTTPS URL.' }, 400); }
  }
  const [row] = await statement(sql,
    'UPDATE admin_videos SET title = $1, description = $2, year = $3, genre = $4, poster_url = $5, published = $6, updated = $7 WHERE id = $8 RETURNING *',
    [title, description, year, genre, posterUrl || null, published, Date.now(), id]);
  await cacheDelete(env, PUBLIC_CACHE_KEY);
  return json({ video: record(row) });
}

async function publicVideos(env, sql) {
  const cached = await cacheGet(env, PUBLIC_CACHE_KEY);
  if (Array.isArray(cached)) return cached;
  const rows = await statement(sql,
    'SELECT * FROM admin_videos WHERE published = TRUE ORDER BY created DESC LIMIT 300');
  const visible = rows.filter(row => !isTakenDown(row.identifier) &&
    !isForbidden({ title: row.title, description: row.description, subject: row.genre }));
  const videos = visible.map(record);
  await cacheSet(env, PUBLIC_CACHE_KEY, videos, 60);
  return videos;
}

async function adminRoute(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/admin/session') {
    if (request.method === 'POST') return signIn(request, env);
    if (request.method === 'GET') return await validSession(request, env.ADMIN_SESSION_SECRET) ? json({ ok: true }) : empty(401);
    return empty(405);
  }
  if (path === '/api/admin/logout' && request.method === 'POST') {
    if (!sameSite(request)) return empty(403);
    return json({ ok: true }, 200, { 'Set-Cookie': 'of_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
  }
  if (path === '/api/uploads' && request.method === 'GET') {
    if (!env.DATABASE_URL && typeof env.NEON_CLIENT !== 'function') return json({ videos: [] });
    const sql = database(env);
    return json({ videos: await publicVideos(env, sql) }, 200, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
  }
  if (!await validSession(request, env.ADMIN_SESSION_SECRET)) return empty(401);
  if (path === '/api/admin/archive-preview') return previewItem(request, env);
  if (!env.DATABASE_URL && typeof env.NEON_CLIENT !== 'function') {
    return json({ error: 'Neon is not configured. Set the DATABASE_URL Worker secret.' }, 503);
  }
  const sql = database(env);
  if (path === '/api/admin/videos' && request.method === 'GET') {
    const rows = await statement(sql, 'SELECT * FROM admin_videos ORDER BY created DESC LIMIT 500');
    return json({ videos: rows.map(record) });
  }
  if (path === '/api/admin/videos') return addItem(request, env, sql);
  const match = path.match(/^\/api\/admin\/videos\/([a-f0-9]{24})$/);
  if (match) return updateItem(request, env, match[1], sql);
  return empty(404);
}

export async function handle(request, _query, env) {
  try { return await adminRoute(request, env); }
  catch (error) {
    console.error('admin:', error?.message || error);
    return json({ error: 'The admin request could not be completed.' }, 500);
  }
}
