import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../api/admin.js';

const originalFetch = globalThis.fetch;
const archivePayload = identifier => ({
  metadata: { identifier, mediatype: 'movies', title: 'Curated Film', description: 'A classic feature.', year: '1936', runtime: '80 minutes', subject: ['Drama'] },
  files: [{ name: 'curated-film.mp4', size: '100000000', format: 'MPEG4' }],
});

function mockNeon() {
  const rows = new Map();
  const sql = async (strings, ...values) => {
    const query = strings.reduce((text, part, index) => text + part + (index < values.length ? '?' : ''), '').replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO admin_videos')) {
      const [id, identifier, title, description, year, genre, poster_url, archive_url, runtime, video_files, file_size, created, updated] = values;
      if ([...rows.values()].some(row => row.identifier === identifier)) return [];
      const row = { id, identifier, title, description, year, genre, poster_url, archive_url, runtime, video_files, file_size, published: false, created, updated };
      rows.set(id, row);
      return [row];
    }
    if (query.startsWith('SELECT * FROM admin_videos WHERE id')) {
      const row = rows.get(values[0]);
      return row ? [{ ...row }] : [];
    }
    if (query.startsWith('UPDATE admin_videos')) {
      const [title, description, year, genre, poster_url, published, updated, id] = values;
      const current = rows.get(id);
      if (!current) return [];
      const row = { ...current, title, description, year, genre, poster_url, published, updated };
      rows.set(id, row);
      return [row];
    }
    if (query.startsWith('DELETE FROM admin_videos')) { rows.delete(values[0]); return []; }
    if (query.startsWith('SELECT * FROM admin_videos WHERE published = TRUE')) return [...rows.values()].filter(row => row.published).map(row => ({ ...row }));
    if (query.startsWith('SELECT * FROM admin_videos')) return [...rows.values()].map(row => ({ ...row }));
    throw new Error('Unexpected mock Neon query: ' + query);
  };
  sql.rows = rows;
  return sql;
}

const originHeaders = { Origin: 'https://example.test', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
const env = {
  ADMIN_PASSWORD: 'test-password',
  ADMIN_SESSION_SECRET: 'test-session-secret-with-more-than-32-characters',
  NEON_CLIENT: mockNeon(),
};
const request = (path, options = {}, cookie = '') => new Request('https://example.test' + path, {
  ...options,
  headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
});

test('Neon-backed Archive.org admin API enforces login, validates, publishes and removes local listings', async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'archive.org');
    assert.equal(url.pathname, '/metadata/curated-film');
    return new Response(JSON.stringify(archivePayload('curated-film')), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const crossOriginLogin = await handle(request('/api/admin/session', {
      method: 'POST', headers: { ...originHeaders, Origin: 'https://evil.test' }, body: JSON.stringify({ password: 'test-password' }),
    }), {}, env);
    assert.equal(crossOriginLogin.status, 403);

    const badLogin = await handle(request('/api/admin/session', {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ password: 'wrong-password' }),
    }), {}, env);
    assert.equal(badLogin.status, 401);

    const login = await handle(request('/api/admin/session', {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ password: 'test-password' }),
    }), {}, env);
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

    const session = await handle(request('/api/admin/session', {}, cookie), {}, env);
    assert.equal(session.status, 200);
    const unauthenticatedList = await handle(request('/api/admin/videos'), {}, env);
    assert.equal(unauthenticatedList.status, 401);

    const preview = await handle(request('/api/admin/archive-preview?item=curated-film', {}, cookie), {}, env);
    assert.equal(preview.status, 200);
    const previewData = await preview.json();
    assert.equal(previewData.item.identifier, 'curated-film');
    assert.equal(previewData.item.video_files, 1);

    const add = await handle(request('/api/admin/videos', {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ item: 'curated-film' }),
    }, cookie), {}, env);
    assert.equal(add.status, 201);
    const added = await add.json();
    assert.equal(added.video.published, false);
    assert.equal(env.NEON_CLIENT.rows.size, 1);

    const duplicate = await handle(request('/api/admin/videos', {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ item: 'curated-film' }),
    }, cookie), {}, env);
    assert.equal(duplicate.status, 409);

    const publicDrafts = await handle(request('/api/uploads'), {}, env);
    assert.equal((await publicDrafts.json()).videos.length, 0);

    const list = await handle(request('/api/admin/videos', {}, cookie), {}, env);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).videos.length, 1);

    const id = added.video.id;
    const publish = await handle(request('/api/admin/videos/' + id, {
      method: 'PATCH', headers: originHeaders, body: JSON.stringify({ published: true }),
    }, cookie), {}, env);
    assert.equal(publish.status, 200);

    const publicPublished = await handle(request('/api/uploads'), {}, env);
    const publishedItems = (await publicPublished.json()).videos;
    assert.equal(publishedItems.length, 1);
    assert.equal(publishedItems[0].identifier, 'curated-film');

    const remove = await handle(request('/api/admin/videos/' + id, {
      method: 'DELETE', headers: originHeaders,
    }, cookie), {}, env);
    assert.equal(remove.status, 200);
    assert.equal((await remove.json()).removed_from_site, 'curated-film');
    assert.equal(env.NEON_CLIENT.rows.size, 0);

    const logout = await handle(request('/api/admin/logout', { method: 'POST', headers: originHeaders }, cookie), {}, env);
    assert.equal(logout.status, 200);
    const invalidated = await handle(request('/api/admin/session', {}, logout.headers.get('set-cookie').split(';')[0]), {}, env);
    assert.equal(invalidated.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});
