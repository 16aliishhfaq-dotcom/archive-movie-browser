// Private admin API: password login, signed sessions, and server-side Internet Archive uploads.
// IA credentials and the admin password are Worker secrets; none are sent to the browser.
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_JSON = 16_384;
const MAX_UPLOAD = 95 * 1024 * 1024;
const attempts = new Map();
const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const empty = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const b64u = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const unb64u = text => {
  const value = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(value + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const clean = (value, max) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const randomHex = length => hex(crypto.getRandomValues(new Uint8Array(length)));

function sameSite(request) {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (!site && !origin) return false;
  if (site && site !== 'same-origin') return false;
  try { return !origin || new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

function overLimit(key, max, windowMs) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.until <= now) {
    attempts.set(key, { count: 1, until: now + windowMs });
    if (attempts.size > 5000) {
      for (const [name, item] of attempts) if (item.until <= now) attempts.delete(name);
    }
    return false;
  }
  current.count += 1;
  return current.count > max;
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_JSON) return { error: 413 };
  const text = await request.text();
  if (text.length > MAX_JSON) return { error: 413 };
  try { return { body: text ? JSON.parse(text) : {} }; } catch { return { error: 400 }; }
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function issueSession(secret) {
  const payload = b64u(encoder.encode(JSON.stringify({ sub: 'admin', exp: Date.now() + SESSION_MS })));
  const key = await sessionKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${b64u(signature)}`;
}

async function validSession(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('of_admin='))?.slice('of_admin='.length) || '';
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  try {
    const key = await sessionKey(secret);
    if (!await crypto.subtle.verify('HMAC', key, unb64u(signature), encoder.encode(payload))) return false;
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
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function safeFilename(input) {
  const leaf = String(input || '').split(/[\\/]/).pop() || 'video.mp4';
  const name = leaf.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-120);
  return name || 'video.mp4';
}

function videoType(filename, supplied) {
  const extension = filename.toLowerCase().split('.').pop();
  const types = {
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime',
    webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mpeg: 'video/mpeg', mpg: 'video/mpeg', ogv: 'video/ogg',
  };
  return types[extension] ? (String(supplied || '').startsWith('video/') ? supplied : types[extension]) : null;
}

function videoRecord(row) {
  return {
    id: row.id, identifier: row.identifier, title: row.title, description: row.description,
    year: row.year, genre: row.genre, poster_url: row.poster_url, filename: row.filename,
    file_size: row.file_size, mime_type: row.mime_type, archive_url: row.archive_url,
    status: row.status, published: !!row.published, created: row.created, updated: row.updated,
    error: row.error || null,
  };
}
function publicRecord(row) {
  return {
    id: row.id, identifier: row.identifier, title: row.title, description: row.description,
    year: row.year, genre: row.genre, poster_url: row.poster_url, archive_url: row.archive_url,
    created: row.created,
  };
}

async function signIn(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    return json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD and a 32-character ADMIN_SESSION_SECRET.' }, 503);
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (overLimit(`login:${ip}`, 8, 15 * 60 * 1000)) return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  if (!await passwordMatches(parsed.body?.password, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password.' }, 401);
  attempts.delete(`login:${ip}`);
  const token = await issueSession(env.ADMIN_SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': `of_admin=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
  });
}

async function uploadVideo(request, env) {
  if (request.method !== 'POST') return empty(405);
  if (!sameSite(request)) return empty(403);
  if (!env.DB || !env.IA_S3_ACCESS_KEY || !env.IA_S3_SECRET_KEY) {
    return json({ error: 'Video storage is not configured. Add the D1 binding and IA S3 secrets.' }, 503);
  }
  const url = new URL(request.url);
  const title = clean(url.searchParams.get('title'), 180);
  const description = clean(url.searchParams.get('description'), 2000);
  const yearText = clean(url.searchParams.get('year'), 4);
  const genre = clean(url.searchParams.get('genre'), 80);
  const posterUrl = clean(url.searchParams.get('posterUrl'), 500);
  const filename = safeFilename(url.searchParams.get('filename'));
  const mimeType = videoType(filename, request.headers.get('content-type'));
  const fileSize = Number(request.headers.get('content-length') || 0);
  const maxSize = Math.min(Number(env.ADMIN_MAX_UPLOAD_BYTES) || MAX_UPLOAD, MAX_UPLOAD);
  if (!title) return json({ error: 'Enter a video title.' }, 400);
  if (!mimeType) return json({ error: 'Choose a supported video file (MP4, M4V, MOV, WebM, MKV, AVI, MPEG or OGV).' }, 400);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return json({ error: 'The video file is empty or its size could not be determined.' }, 400);
  if (fileSize > maxSize) return json({ error: `This deployment accepts files up to ${Math.floor(maxSize / 1024 / 1024)} MB per upload. Larger video uploads need a separate large-file upload service.` }, 413);
  if (yearText && (!/^\d{4}$/.test(yearText) || Number(yearText) < 1880 || Number(yearText) > 2100)) return json({ error: 'Enter a valid four-digit release year.' }, 400);
  if (posterUrl) {
    try { if (new URL(posterUrl).protocol !== 'https:') throw new Error(); } catch { return json({ error: 'Poster URL must be a valid HTTPS URL.' }, 400); }
  }
  const id = randomHex(12);
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'video';
  const identifier = `orphanedfilms-${slug}-${id.slice(0, 8)}`;
  const now = Date.now();
  const archiveUrl = `https://archive.org/details/${identifier}`;
  await env.DB.prepare(`INSERT INTO admin_videos
    (id, identifier, title, description, year, genre, poster_url, filename, file_size, mime_type, archive_url, status, published, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 0, ?, ?)`)
    .bind(id, identifier, title, description, yearText ? Number(yearText) : null, genre, posterUrl || null, filename, fileSize, mimeType, archiveUrl, now, now).run();

  const headers = new Headers({
    Authorization: `LOW ${env.IA_S3_ACCESS_KEY}:${env.IA_S3_SECRET_KEY}`,
    'Content-Type': mimeType,
    'x-archive-auto-make-bucket': '1',
    'x-archive-keep-old-version': '1',
    'x-archive-meta-title': title,
    'x-archive-meta-mediatype': 'movies',
  });
  if (description) headers.set('x-archive-meta-description', description);
  if (yearText) headers.set('x-archive-meta-year', yearText);
  if (genre) headers.set('x-archive-meta-subject', genre);
  if (env.IA_COLLECTION) headers.set('x-archive-meta-collection', env.IA_COLLECTION);

  try {
    const destination = `https://s3.us.archive.org/${identifier}/${encodeURIComponent(filename)}`;
    const upstream = await fetch(destination, { method: 'PUT', headers, body: request.body });
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      await env.DB.prepare("UPDATE admin_videos SET status = 'failed', error = ?, updated = ? WHERE id = ?")
        .bind(`Archive.org returned HTTP ${upstream.status}${detail ? `: ${detail}` : ''}`, Date.now(), id).run();
      return json({ error: `Archive.org rejected the upload (HTTP ${upstream.status}).`, detail }, 502);
    }
    await env.DB.prepare("UPDATE admin_videos SET status = 'uploaded', error = NULL, updated = ? WHERE id = ?")
      .bind(Date.now(), id).run();
    const row = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
    return json({ video: videoRecord(row) }, 201);
  } catch (error) {
    const detail = clean(error?.message || 'Upload failed', 240);
    await env.DB.prepare("UPDATE admin_videos SET status = 'failed', error = ?, updated = ? WHERE id = ?")
      .bind(detail, Date.now(), id).run().catch(() => {});
    return json({ error: 'The upload could not be completed.', detail }, 502);
  }
}

async function updateVideo(request, env, id) {
  if (request.method !== 'PATCH') return empty(405);
  if (!sameSite(request)) return empty(403);
  const parsed = await readJson(request);
  if (parsed.error) return empty(parsed.error);
  const body = parsed.body || {};
  const current = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
  if (!current) return empty(404);

  const title = body.title === undefined ? current.title : clean(body.title, 180);
  const description = body.description === undefined ? current.description : clean(body.description, 2000);
  const year = body.year === undefined ? current.year : (body.year === '' || body.year === null ? null : Number(body.year));
  const genre = body.genre === undefined ? current.genre : clean(body.genre, 80);
  const posterUrl = body.poster_url === undefined ? current.poster_url : clean(body.poster_url, 500);
  const published = body.published === undefined ? current.published : (body.published ? 1 : 0);
  if (!title) return json({ error: 'Title cannot be empty.' }, 400);
  if (year !== null && (!Number.isInteger(year) || year < 1880 || year > 2100)) return json({ error: 'Enter a valid release year.' }, 400);
  if (posterUrl) {
    try { if (new URL(posterUrl).protocol !== 'https:') throw new Error(); } catch { return json({ error: 'Poster URL must be a valid HTTPS URL.' }, 400); }
  }

  const metadataChanged = title !== current.title || description !== current.description || year !== current.year || genre !== current.genre;
  if (metadataChanged) {
    if (!env.IA_S3_ACCESS_KEY || !env.IA_S3_SECRET_KEY) return json({ error: 'Archive.org credentials are not configured.' }, 503);
    const patch = { title, description, year: year ? String(year) : '', subject: genre ? [genre] : [] };
    const form = new URLSearchParams({
      '-target': 'metadata', '-patch': JSON.stringify(patch),
      access: env.IA_S3_ACCESS_KEY, secret: env.IA_S3_SECRET_KEY,
    });
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(current.identifier)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    if (!response.ok) return json({ error: 'Could not update Archive.org metadata. Website details were not changed.' }, 502);
    const result = await response.json().catch(() => null);
    if (result?.success === false) return json({ error: 'Archive.org rejected the metadata update.' }, 502);
  }

  await env.DB.prepare(`UPDATE admin_videos SET title = ?, description = ?, year = ?, genre = ?, poster_url = ?,
    published = ?, updated = ? WHERE id = ?`)
    .bind(title, description, year, genre, posterUrl || null, published, Date.now(), id).run();
  const row = await env.DB.prepare('SELECT * FROM admin_videos WHERE id = ?').bind(id).first();
  return json({ video: videoRecord(row) });
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
    return json({ ok: true }, 200, {
      'Set-Cookie': 'of_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    });
  }
  if (path === '/api/uploads' && request.method === 'GET') {
    if (!env.DB) return json({ videos: [] }, 200, { 'Cache-Control': 'public, s-maxage=60' });
    const rows = (await env.DB.prepare("SELECT * FROM admin_videos WHERE status = 'uploaded' AND published = 1 ORDER BY created DESC LIMIT 300").all()).results;
    return json({ videos: rows.map(publicRecord) }, 200, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
  }

  if (!await validSession(request, env.ADMIN_SESSION_SECRET)) return empty(401);
  if (path === '/api/admin/videos' && request.method === 'GET') {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 503);
    const rows = (await env.DB.prepare('SELECT * FROM admin_videos ORDER BY created DESC LIMIT 500').all()).results;
    return json({ videos: rows.map(videoRecord) });
  }
  if (path === '/api/admin/upload') return uploadVideo(request, env);
  const match = path.match(/^\/api\/admin\/videos\/([a-f0-9]{24})$/);
  if (match) return updateVideo(request, env, match[1]);
  return empty(404);
}

export async function handle(request, _query, env) {
  try { return await adminRoute(request, env); }
  catch (error) {
    console.error('admin:', error?.message || error);
    return json({ error: 'The admin request could not be completed.' }, 500);
  }
}
