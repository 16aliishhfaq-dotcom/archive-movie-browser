import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../api/admin.js';

const originalFetch = globalThis.fetch;
const payload = identifier => ({
  metadata: { identifier, mediatype: 'movies', title: 'Curated Film', description: 'Classic feature.', year: '1936', subject: ['Drama'] },
  files: [{ name: 'film.mp4', size: '1000000' }],
});
function mockNeon() {
  const rows = new Map();
  const sql = async (strings, ...values) => {
    const query = strings.reduce((s, part, i) => s + part + (i < values.length ? '?' : ''), '').replace(/\s+/g, ' ').trim();
    if (query.startsWith('INSERT INTO movies')) {
      const [id, movie_name, category, poster, movie_link] = values;
      if ([...rows.values()].some(row => row.movie_link === movie_link)) return [];
      const row = { id, movie_name, category, poster, movie_link }; rows.set(id, row); return [{ ...row }];
    }
    if (query.startsWith('SELECT id, movie_name, category, poster, movie_link FROM movies WHERE id')) {
      const row = rows.get(values[0]); return row ? [{ ...row }] : [];
    }
    if (query.startsWith('SELECT id, movie_name, category, poster, movie_link FROM movies')) return [...rows.values()].map(row => ({ ...row }));
    if (query.startsWith('UPDATE movies')) {
      const [movie_name, category, poster, movie_link, id] = values, current = rows.get(id);
      if (!current) return [];
      const row = { id, movie_name, category, poster, movie_link }; rows.set(id, row); return [{ ...row }];
    }
    if (query.startsWith('DELETE FROM movies')) { rows.delete(values[0]); return []; }
    throw new Error('Unexpected mock query: ' + query);
  };
  sql.rows = rows; return sql;
}
const headers = { Origin: 'https://example.test', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
const env = { ADMIN_PASSWORD: 'test-password', ADMIN_SESSION_SECRET: 'test-session-secret-with-more-than-32-characters', NEON_CLIENT: mockNeon() };
const request = (path, options = {}, cookie = '') => new Request('https://example.test' + path, { ...options, headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });

test('Neon movie-only schema: admin login, Archive.org validation, CRUD and public catalogue', async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'archive.org'); assert.equal(url.pathname, '/metadata/curated-film');
    return new Response(JSON.stringify(payload('curated-film')), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const cross = await handle(request('/api/admin/session', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: JSON.stringify({ password: 'test-password' }) }), {}, env);
    assert.equal(cross.status, 403);
    const wrong = await handle(request('/api/admin/session', { method: 'POST', headers, body: JSON.stringify({ password: 'wrong' }) }), {}, env);
    assert.equal(wrong.status, 401);
    const login = await handle(request('/api/admin/session', { method: 'POST', headers, body: JSON.stringify({ password: 'test-password' }) }), {}, env);
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const preview = await handle(request('/api/admin/archive-preview?item=curated-film', {}, cookie), {}, env);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).item.movie_name, 'Curated Film');
    const add = await handle(request('/api/admin/movies', { method: 'POST', headers, body: JSON.stringify({
      item: 'curated-film', movie_name: 'Curated Film', category: 'Drama', poster: 'https://archive.org/services/img/curated-film', movie_link: 'https://archive.org/details/curated-film',
    }) }, cookie), {}, env);
    assert.equal(add.status, 201);
    const movie = (await add.json()).movie;
    assert.deepEqual(Object.keys(movie).sort(), ['id', 'movie_name', 'category', 'poster', 'movie_link'].sort());
    assert.equal(env.NEON_CLIENT.rows.size, 1);
    const duplicate = await handle(request('/api/admin/movies', { method: 'POST', headers, body: JSON.stringify({ item: 'curated-film' }) }, cookie), {}, env);
    assert.equal(duplicate.status, 409);
    const pub = await handle(request('/api/uploads'), {}, env);
    assert.equal((await pub.json()).movies.length, 1);
    const update = await handle(request('/api/admin/movies/' + movie.id, { method: 'PATCH', headers, body: JSON.stringify({ movie_name: 'Edited Film', category: 'Classic' }) }, cookie), {}, env);
    assert.equal((await update.json()).movie.movie_name, 'Edited Film');
    const cache = await handle(request('/api/admin/cache', {}, cookie), {}, env);
    assert.equal((await cache.json()).enabled, false);
    const remove = await handle(request('/api/admin/movies/' + movie.id, { method: 'DELETE', headers }, cookie), {}, env);
    assert.equal((await remove.json()).removed, 'Edited Film');
    assert.equal(env.NEON_CLIENT.rows.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});
