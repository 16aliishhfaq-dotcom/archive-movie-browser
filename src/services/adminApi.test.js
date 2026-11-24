import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../api/admin.js';

const originalFetch = globalThis.fetch;
const archivePayload = identifier => ({
  metadata: {
    identifier,
    mediatype: 'movies',
    title: 'Curated Film',
    description: 'A classic feature.',
    year: '1936',
    runtime: '80 minutes',
    subject: ['Drama'],
  },
  files: [{ name: 'curated-film.mp4', size: '100000000', format: 'MPEG4' }],
});

function mockD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() {
          if (sql.startsWith('SELECT id FROM admin_videos WHERE identifier')) {
            const row = [...rows.values()].find(value => value.identifier === params[0]);
            return row ? { id: row.id } : null;
          }
          if (sql.startsWith('SELECT * FROM admin_videos WHERE id')) return rows.get(params[0]) || null;
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT INTO admin_videos')) {
            const [id, identifier, title, description, year, genre, poster_url, archive_url,
              runtime, video_files, file_size, created, updated] = params;
            if ([...rows.values()].some(row => row.identifier === identifier)) {
              throw new Error('UNIQUE constraint failed: admin_videos.identifier');
            }
            rows.set(id, { id, identifier, title, description, year, genre, poster_url, archive_url,
              runtime, video_files, file_size, published: 0, created, updated });
          } else if (sql.startsWith('UPDATE admin_videos')) {
            const [title, description, year, genre, poster_url, published, updated, id] = params;
            const row = rows.get(id);
            if (row) rows.set(id, { ...row, title, description, year, genre, poster_url, published, updated });
          } else if (sql.startsWith('DELETE FROM admin_videos')) {
            rows.delete(params[0]);
          }
          return { success: true };
        },
        async all() {
          let values = [...rows.values()];
          if (sql.includes('WHERE published = 1')) values = values.filter(row => row.published === 1);
          values.sort((a, b) => b.created - a.created);
          return { results: values };
        },
      };
    },
  };
}

const originHeaders = {
  Origin: 'https://example.test',
  'Sec-Fetch-Site': 'same-origin',
  'Content-Type': 'application/json',
};
const env = {
  ADMIN_PASSWORD: 'test-password',
  ADMIN_SESSION_SECRET: 'test-session-secret-with-more-than-32-characters',
  DB: mockD1(),
};
const request = (path, options = {}, cookie = '') => new Request('https://example.test' + path, {
  ...options,
  headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
});

test('Archive.org curation API enforces login, validates, publishes and removes local listings', async () => {
  let activeIdentifier = 'curated-film';
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'archive.org');
    assert.equal(url.pathname, '/metadata/' + activeIdentifier);
    return new Response(JSON.stringify(archivePayload(activeIdentifier)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const crossOriginLogin = await handle(request('/api/admin/session', {
      method: 'POST',
      headers: { ...originHeaders, Origin: 'https://evil.test' },
      body: JSON.stringify({ password: 'test-password' }),
    }), {}, env);
    assert.equal(crossOriginLogin.status, 403, 'cross-origin login is rejected');

    const badLogin = await handle(request('/api/admin/session', {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ password: 'wrong-password' }),
    }), {}, env);
    assert.equal(badLogin.status, 401, 'wrong password is rejected');

    const login = await handle(request('/api/admin/session', {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ password: 'test-password' }),
    }), {}, env);
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

    const session = await handle(request('/api/admin/session', {}, cookie), {}, env);
    assert.equal(session.status, 200, 'signed cookie validates');

    const unauthenticatedList = await handle(request('/api/admin/videos'), {}, env);
    assert.equal(unauthenticatedList.status, 401, 'private catalogue requires a session');

    const preview = await handle(request('/api/admin/archive-preview?item=curated-film', {}, cookie), {}, env);
    assert.equal(preview.status, 200);
    const previewData = await preview.json();
    assert.equal(previewData.item.identifier, 'curated-film');
    assert.equal(previewData.item.video_files, 1);

    const add = await handle(request('/api/admin/videos', {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ item: 'curated-film' }),
    }, cookie), {}, env);
    assert.equal(add.status, 201);
    const added = await add.json();
    assert.equal(added.video.published, false, 'items begin as drafts');
    assert.equal(env.DB.rows.size, 1);

    const duplicate = await handle(request('/api/admin/videos', {
      method: 'POST',
      headers: originHeaders,
      body: JSON.stringify({ item: 'curated-film' }),
    }, cookie), {}, env);
    assert.equal(duplicate.status, 409, 'duplicate identifiers are rejected');

    const publicDrafts = await handle(request('/api/uploads'), {}, env);
    assert.equal((await publicDrafts.json()).videos.length, 0, 'draft remains hidden from the public site');

    const list = await handle(request('/api/admin/videos', {}, cookie), {}, env);
    const listed = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listed.videos.length, 1);

    const id = added.video.id;
    const publish = await handle(request('/api/admin/videos/' + id, {
      method: 'PATCH',
      headers: originHeaders,
      body: JSON.stringify({ published: true }),
    }, cookie), {}, env);
    assert.equal(publish.status, 200);

    const publicPublished = await handle(request('/api/uploads'), {}, env);
    const publishedItems = (await publicPublished.json()).videos;
    assert.equal(publishedItems.length, 1);
    assert.equal(publishedItems[0].identifier, 'curated-film');

    const remove = await handle(request('/api/admin/videos/' + id, {
      method: 'DELETE',
      headers: originHeaders,
    }, cookie), {}, env);
    assert.equal(remove.status, 200);
    const removal = await remove.json();
    assert.equal(removal.removed_from_site, 'curated-film');
    assert.equal(env.DB.rows.size, 0, 'only the local catalogue record is deleted');

    const logout = await handle(request('/api/admin/logout', {
      method: 'POST',
      headers: originHeaders,
    }, cookie), {}, env);
    assert.equal(logout.status, 200);
    const invalidated = await handle(request('/api/admin/session', {}, logout.headers.get('set-cookie').split(';')[0]), {}, env);
    assert.equal(invalidated.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
