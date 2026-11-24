// Archive.org curation. Neon stores only id, movie_name, category, poster, movie_link.
import { neon } from '@neondatabase/serverless';
import { redis } from './_redis.js';
import { normalizeArchiveItem, parseArchiveIdentifier } from '../src/services/adminArchive.js';
import { isForbidden, isTakenDown } from '../src/services/policy.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const PUBLIC_CACHE_KEY = 'orphanedfilms:movies:public:v2';
const CACHE_SECONDS = 300;
const attempts = new Map();
const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers,
} });
const empty = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const randomHex = length => [...crypto.getRandomValues(new Uint8Array(length))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const b64u = bytes => {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const unb64u = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));

function sameSite(request) {
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if (site && site !== 'same-origin') return false;
  if (origin) { try { return new URL(origin).host === new URL(request.url).host; } catch { return false; } }
  return site === 'same-origin';
}
function statement(sql, source, values = []) {
  const strings = [], params = []; let offset = 0, match;
  const re = /\$(\d+)/g;
  while ((match = re.exec(source))) { strings.push(source.slice(offset, match.index)); params.push(values[Number(match[1]) - 1]); offset = re.lastIndex; }
  strings.push(source.slice(offset)); strings.raw = strings.slice();
  return sql(strings, ...params);
}
function database(env) {
  if (typeof env.NEON_CLIENT === 'function') return env.NEON_CLIENT;
  if (!env.DATABASE_URL) throw new Error('Neon is not configured. Set DATABASE_URL.');
  return neon(env.DATABASE_URL);
}
function redisConfigured(env) {
  return !!((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL) && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN));
}
async function cacheGet(env, key) {
  if (!redisConfigured(env)) return null;
  try {
    const [value] = await redis([['GET', key]], { readOnly: true, env });
    if (typeof value !== 'string') return value ?? null;
    try { return JSON.parse(value); } catch { return null; }
  } catch { return null; }
}
async function cacheSet(env, key, value, seconds = CACHE_SECONDS) {
  if (!redisConfigured(env)) return false;
  try { await redis([['SET', key, JSON.stringify(value), 'EX', seconds]], { env }); return true; } catch { return false; }
}
async function cacheDelete(env, key) {
  if (!redisConfigured(env)) return false;
  try { await redis([['DEL', key]], { env }); return true; } catch { return false; }
}
async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 16384) return { error: 413 };
  const body = await request.text();
  if (body.length > 16384) return { error: 413 };
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
  const token = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('of_admin='))?.slice(9) || '';
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
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(supplied)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const left = new Uint8Array(a), right = new Uint8Array(b); let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
function movieRecord(row) {
  return { id: row.id, movie_name: row.movie_name, category: row.category, poster: row.poster || '', movie_link: row.movie_link };
}
async function fetchArchiveItem(identifier, env, fresh = false) {
  const key = 'orphanedfilms:archive:item:' + identifier;
  if (!fresh) {
    const cached = await cacheGet(env, key);
    if (cached?.identifier === identifier && !isTakenDown(identifier) && !isForbidden({ title: cached.title, description: cached.description, subject: cached.genre })) return cached;
  }
  const response = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'Archive.org could not find that item.' : 'Archive.org is temporarily unavailable.');
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('Archive.org returned unreadable metadata.');
  const item = normalizeArchiveItem(payload, identifier);
  await cacheSet(env, key, item);
  return item;
}
async function signIn(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return json({ error: 'Set ADMIN_PASSWORD and an ADMIN_SESSION_SECRET of at least 32 characters.' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (overLimit('login:' + ip, 8, LOGIN_WINDOW_SECONDS * 1000)) return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  const parsed = await readJson(request); if (parsed.error) return empty(parsed.error);
  if (!await passwordMatches(parsed.body?.password, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password.' }, 401);
  const token = await issueSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, { 'Set-Cookie': 'of_admin=' + token + '; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict' });
}
async function previewItem(request, env) {
  if (request.method !== 'GET') return empty(405);
  let identifier;
  try { identifier = parseArchiveIdentifier(new URL(request.url).searchParams.get('item')); } catch (e) { return json({ error: e.message }, 400); }
  try {
    const item = await fetchArchiveItem(identifier, env);
    return json({ item: { identifier, movie_name: item.title, category: item.genre || 'Uncategorized', poster: item.poster_url, movie_link: item.archive_url } });
  } catch (e) { return json({ error: clean(e?.message || 'Could not read Archive.org item.', 300) }, 422); }
}
async function addMovie(request, env, sql) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  const parsed = await readJson(request); if (parsed.error) return empty(parsed.error);
  let identifier;
  try { identifier = parseArchiveIdentifier(parsed.body?.item || parsed.body?.movie_link); } catch (e) { return json({ error: e.message }, 400); }
  try {
    const item = await fetchArchiveItem(identifier, env, true);
    const movieName = clean(parsed.body?.movie_name || item.title, 180);
    const category = clean(parsed.body?.category || item.genre || 'Uncategorized', 100);
    const poster = clean(parsed.body?.poster || item.poster_url, 1000);
    const movieLink = clean(parsed.body?.movie_link || item.archive_url, 500);
    if (!movieName || !category) return json({ error: 'Movie name and category are required.' }, 400);
    if (isTakenDown(identifier) || isForbidden({ title: movieName, subject: category })) return json({ error: 'This movie is blocked by the site content/takedown policy.' }, 400);
    try { if (!poster || new URL(poster).protocol !== 'https:') throw new Error(); } catch { return json({ error: 'Poster must be a valid HTTPS URL.' }, 400); }
    try { if (parseArchiveIdentifier(movieLink) !== identifier) throw new Error(); } catch { return json({ error: 'Movie link must point to the same Archive.org item.' }, 400); }
    const [row] = await statement(sql, 'INSERT INTO movies (id, movie_name, category, poster, movie_link) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (movie_link) DO NOTHING RETURNING id, movie_name, category, poster, movie_link',
      [randomHex(12), movieName, category, poster, movieLink]);
    if (!row) return json({ error: 'This Archive.org movie is already in your library.' }, 409);
    await cacheDelete(env, PUBLIC_CACHE_KEY);
    return json({ movie: movieRecord(row) }, 201);
  } catch (e) {
    if (String(e?.message || '').toLowerCase().includes('unique')) return json({ error: 'This movie is already in your library.' }, 409);
    return json({ error: clean(e?.message || 'Could not add movie.', 300) }, 422);
  }
}
async function updateMovie(request, env, id, sql) {
  if (!['PATCH', 'DELETE'].includes(request.method)) return empty(405);
  if (!sameSite(request)) return empty(403);
  const [current] = await statement(sql, 'SELECT id, movie_name, category, poster, movie_link FROM movies WHERE id = $1 LIMIT 1', [id]);
  if (!current) return empty(404);
  if (request.method === 'DELETE') {
    await statement(sql, 'DELETE FROM movies WHERE id = $1', [id]);
    await cacheDelete(env, PUBLIC_CACHE_KEY);
    return json({ ok: true, removed: current.movie_name });
  }
  const parsed = await readJson(request); if (parsed.error) return empty(parsed.error);
  const body = parsed.body || {};
  const movieName = body.movie_name === undefined ? current.movie_name : clean(body.movie_name, 180);
  const category = body.category === undefined ? current.category : clean(body.category, 100);
  const poster = body.poster === undefined ? current.poster : clean(body.poster, 1000);
  const movieLink = body.movie_link === undefined ? current.movie_link : clean(body.movie_link, 500);
  if (!movieName || !category) return json({ error: 'Movie name and category are required.' }, 400);
  let identifier;
  try { identifier = parseArchiveIdentifier(movieLink); } catch { return json({ error: 'Movie link must be a valid Archive.org details or embed link.' }, 400); }
  if (isTakenDown(identifier) || isForbidden({ title: movieName, subject: category })) return json({ error: 'This movie is blocked by the site content/takedown policy.' }, 400);
  try { if (!poster || new URL(poster).protocol !== 'https:') throw new Error(); } catch { return json({ error: 'Poster must be a valid HTTPS URL.' }, 400); }
  const [row] = await statement(sql, 'UPDATE movies SET movie_name = $1, category = $2, poster = $3, movie_link = $4 WHERE id = $5 RETURNING id, movie_name, category, poster, movie_link',
    [movieName, category, poster, movieLink, id]);
  await cacheDelete(env, PUBLIC_CACHE_KEY);
  return json({ movie: movieRecord(row) });
}
async function publicMovies(env, sql) {
  const cached = await cacheGet(env, PUBLIC_CACHE_KEY);
  if (Array.isArray(cached)) return cached;
  const rows = await statement(sql, 'SELECT id, movie_name, category, poster, movie_link FROM movies ORDER BY movie_name ASC LIMIT 500');
  const movies = rows.filter(row => {
    try {
      const identifier = parseArchiveIdentifier(row.movie_link);
      return !isTakenDown(identifier) && !isForbidden({ title: row.movie_name, subject: row.category });
    } catch { return false; }
  }).map(movieRecord);
  await cacheSet(env, PUBLIC_CACHE_KEY, movies, CACHE_SECONDS);
  return movies;
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
    if (!env.DATABASE_URL && typeof env.NEON_CLIENT !== 'function') return json({ movies: [] });
    return json({ movies: await publicMovies(env, database(env)) }, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  }
  if (!await validSession(request, env.ADMIN_SESSION_SECRET)) return empty(401);
  if (path === '/api/admin/cache' && request.method === 'GET') {
    if (!redisConfigured(env)) return json({ enabled: false, connected: false, provider: 'Upstash Redis', ttl_seconds: CACHE_SECONDS });
    try { const [pong] = await redis([['PING']], { readOnly: true, env }); return json({ enabled: pong === 'PONG', connected: pong === 'PONG', provider: 'Upstash Redis', ttl_seconds: CACHE_SECONDS }); }
    catch { return json({ enabled: false, connected: false, provider: 'Upstash Redis', ttl_seconds: CACHE_SECONDS }); }
  }
  if (path === '/api/admin/archive-preview') return previewItem(request, env);
  if (!env.DATABASE_URL && typeof env.NEON_CLIENT !== 'function') return json({ error: 'Neon is not configured. Set DATABASE_URL.' }, 503);
  const sql = database(env);
  if (path === '/api/admin/movies' && request.method === 'GET') {
    const rows = await statement(sql, 'SELECT id, movie_name, category, poster, movie_link FROM movies ORDER BY movie_name ASC LIMIT 500');
    return json({ movies: rows.map(movieRecord) });
  }
  if (path === '/api/admin/movies') return addMovie(request, env, sql);
  const match = path.match(/^\/api\/admin\/movies\/([a-f0-9]{24})$/);
  if (match) return updateMovie(request, env, match[1], sql);
  return empty(404);
}
export async function handle(request, _query, env) {
  try { return await adminRoute(request, env); }
  catch (error) { console.error('admin:', error?.message || error); return json({ error: 'The admin request could not be completed.' }, 500); }
}
