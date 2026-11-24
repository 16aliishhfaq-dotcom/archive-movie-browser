// Curate existing Archive.org items. This API never uploads or modifies Archive.org files.
import { normalizeArchiveItem, parseArchiveIdentifier } from '../src/services/adminArchive.js';
import { isForbidden, isTakenDown } from '../src/services/policy.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
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
function overLimit(key, max, windowMs) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.until <= now) {
    attempts.set(key, { count: 1, until: now + windowMs });
    if (attempts.size > 2000) for (const [name, value] of attempts) if (value.until <= now) attempts.delete(name);
    return false;
  }
  current.count += 1;
  return current.count > max;
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
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('of_admin='))?.slice('of_admin='.length) || '';
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
    file_size: Number(row.file_size) || 0, published: !!row.published, created: row.created, updated: row.updated,
  };
}
async function fetchArchiveItem(identifier) {
  const response = await fetch('https://archive.org/metadata/' + encodeURIComponent(identifier), {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Archive.org could not find that item.');
    throw new Error('Archive.org is temporarily unavailable. Try again in a moment.');
  }
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('Archive.org returned an unreadable metadata response.');
  return normalizeArchiveItem(payload, identifier);
}
async function signIn(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    return json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD and a random ADMIN_SESSION_SECRET of at least 32 characters.' }, 503);
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (overLimit('login:' + ip, 8, 15 * 60 * 1000)) return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  if (!await passwordMatches(parsed.body?.password, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password.' }, 401);
  attempts.delete('login:' + ip);
  const token = await issueSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': 'of_admin=' + token + '; Path=/; Max-Age=' + (SESSION_MS / 1000) + '; HttpOnly; Secure; SameSite=Strict',
  });
}
async function previewItem(request) {
  if (request.method !== 'GET') return empty(405);
  let identifier;
  try { identifier = parseArchiveIdentifier(new URL(request.url).searchParams.get('item')); }
  catch (error) { return json({ error: error.message }, 400); }
  try { return json({ item: await fetchArchiveItem(identifier) }); }
  catch (error) { return json({ error: clean(error?.message || 'Could not read this Archive.org item.', 300) }, 422); }
}
async function addItem(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  let identifier;
  try { identifier = parseArchiveIdentifier(parsed.body?.item); }
  catch (error) { return json({ error: error.message }, 400); }
  try {
    const item = await fetchArchiveItem(identifier);
    const existing = await env.DB.prepare('SELECT id FROM admin_videos WHERE identifier = ?').bind(identifier).first();
    if (existing) return json({ error: 'This Archive.org item is already in your site library.' }, 409);
    const id = randomHex(12), now = Date.now();
    await env.DB.prepare('INSERT INTO admin_videos (id, identifier, title, description, year, genre, poster_url, archive_url, runtime, video_files, file_size, published, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, item.identifier, item.title, item.description, item.year, item.genre, item.poster_url,
        item.archive_url, item.runtime, item.video_files, item.file_size, now, now).run();
    const row = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
    return json({ video: record(row) }, 201);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) return json({ error: 'This Archive.org item is already in your site library.' }, 409);
    return json({ error: clean(error?.message || 'Could not add this Archive.org item.', 300) }, 422);
  }
}
async function updateItem(request, env, id) {
  if (!['PATCH', 'DELETE'].includes(request.method)) return empty(405);
  if (!sameSite(request)) return empty(403);
  const current = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
  if (!current) return empty(404);
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM admin_videos WHERE id = ?').bind(id).run();
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
  const published = body.published === undefined ? Number(current.published) : (body.published ? 1 : 0);
  if (!title) return json({ error: 'Title cannot be empty.' }, 400);
  if (published && (isTakenDown(current.identifier) || isForbidden({ title, description, subject: genre }))) {
    return json({ error: 'This item cannot be published because it conflicts with the website content/takedown policy.' }, 400);
  }
  if (year !== null && (!Number.isInteger(year) || year < 1880 || year > 2100)) return json({ error: 'Enter a valid year between 1880 and 2100.' }, 400);
  if (posterUrl) {
    try { if (new URL(posterUrl).protocol !== 'https:') throw new Error(); }
    catch { return json({ error: 'Poster URL must be a valid HTTPS URL.' }, 400); }
  }
  await env.DB.prepare('UPDATE admin_videos SET title = ?, description = ?, year = ?, genre = ?, poster_url = ?, published = ?, updated = ? WHERE id = ?')
    .bind(title, description, year, genre, posterUrl || null, published, Date.now(), id).run();
  const row = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
  return json({ video: record(row) });
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
    if (!env.DB) return json({ videos: [] });
    const rows = (await env.DB.prepare('SELECT * FROM admin_videos WHERE published = 1 ORDER BY created DESC LIMIT 300').all()).results || [];
    const visible = rows.filter(row => !isTakenDown(row.identifier) && !isForbidden({ title: row.title, description: row.description, subject: row.genre }));
    return json({ videos: visible.map(record) });
  }
  if (!await validSession(request, env.ADMIN_SESSION_SECRET)) return empty(401);
  if (!env.DB) return json({ error: 'The D1 database binding is not configured.' }, 503);
  if (path === '/api/admin/archive-preview') return previewItem(request);
  if (path === '/api/admin/videos' && request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT * FROM admin_videos ORDER BY created DESC LIMIT 500').all()).results || [];
    return json({ videos: rows.map(record) });
  }
  if (path === '/api/admin/videos') return addItem(request, env);
  const match = path.match(/^\/api\/admin\/videos\/([a-f0-9]{24})$/);
  if (match) return updateItem(request, env, match[1]);
  return empty(404);
}
export async function handle(request, _query, env) {
  try { return await adminRoute(request, env); }
  catch (error) {
    console.error('admin:', error?.message || error);
    return json({ error: 'The admin request could not be completed.' }, 500);
  }
}
