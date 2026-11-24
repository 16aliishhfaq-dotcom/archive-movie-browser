import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeonDatabaseAdapter, translateSql } from '../../api/_neon-db.js';

test('translates SQLite-specific statements used by the community API', () => {
  assert.equal(
    translateSql('INSERT OR IGNORE INTO favourites (profile_id, film_id, created) VALUES (?, ?, ?)'),
    'INSERT INTO favourites (profile_id, film_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
  );
  assert.match(translateSql('INSERT OR REPLACE INTO limits (bucket, count, until) VALUES (?, 1, ?)'), /ON CONFLICT \(bucket\) DO UPDATE SET count = EXCLUDED\.count, until = EXCLUDED\.until/);
  assert.equal(translateSql('UPDATE passkeys SET counter = MAX(counter, ?) WHERE credential_id = ?'), 'UPDATE passkeys SET counter = GREATEST(counter, ?) WHERE credential_id = ?');
  assert.equal(translateSql('SELECT id FROM profiles WHERE id IS NOT ?'), 'SELECT id FROM profiles WHERE id IS DISTINCT FROM ?');
  assert.equal(translateSql('SELECT * FROM profiles WHERE handle IS ?'), 'SELECT * FROM profiles WHERE handle IS NOT DISTINCT FROM ?');
  assert.match(translateSql("SELECT json_extract(h.detail, '$.name') FROM history h"), /\(h\.detail::jsonb ->> 'name'\)/);
  assert.equal(translateSql('SELECT id FROM channels ORDER BY created, rowid'), 'SELECT id FROM channels ORDER BY created, id');
});

test('adds RETURNING for D1-style change counts without changing existing RETURNING clauses', () => {
  const db = createNeonDatabaseAdapter(makeMockSql());
  assert.match(db.prepare('UPDATE profiles SET hidden = 1 WHERE id = ?').queryText, /RETURNING 1 AS __d1_change$/);
  assert.equal(db.prepare('DELETE FROM challenges WHERE id = ? RETURNING kind').queryText, 'DELETE FROM challenges WHERE id = ? RETURNING kind');
  assert.equal(db.prepare('SELECT * FROM profiles WHERE id = ?').queryText, 'SELECT * FROM profiles WHERE id = ?');
  assert.throws(() => db.prepare('SELECT * FROM profiles WHERE id = ?').asTransactionQuery(makeMockSql()), /placeholder count/);
  assert.throws(() => db.prepare('SELECT * FROM profiles WHERE id = ?').all(), /placeholder count/);
});

function makeMockSql() {
  function tag(strings, ...values) {
    return { text: strings.reduce((out, part, index) => out + part + (index < values.length ? '$' + (index + 1) : ''), ''), values };
  }
  tag.query = async (text, values, options) => {
    tag.lastQuery = text;
    tag.lastValues = values;
    const rows = [{ id: 'profile-1', __d1_change: 1 }];
    return options?.fullResults ? { rows, rowCount: 1 } : rows;
  };
  tag.transaction = async build => {
    const queries = build(tag);
    return queries.map(() => [{ __d1_change: 1 }]);
  };
  return tag;
}

test('binds parameters and returns D1-compatible first/all/run results', async () => {
  const sql = makeMockSql();
  const db = createNeonDatabaseAdapter(sql);
  const statement = db.prepare('SELECT id FROM profiles WHERE id = ?').bind('profile-1');
  assert.equal((await statement.first()).id, 'profile-1');
  assert.equal(sql.lastQuery, 'SELECT id FROM profiles WHERE id = $1');
  assert.deepEqual(sql.lastValues, ['profile-1']);
  assert.equal((await statement.all()).results.length, 1);
  assert.equal(sql.lastQuery, 'SELECT id FROM profiles WHERE id = $1');
  const run = await db.prepare('UPDATE profiles SET hidden = ? WHERE id = ?').bind(1, 'profile-1').run();
  assert.equal(run.meta.changes, 1);
  assert.match(sql.lastQuery || '', /UPDATE profiles SET hidden = \$1 WHERE id = \$2 RETURNING 1 AS __d1_change/);
});

test('runs batches through one Neon transaction and preserves per-statement change metadata', async () => {
  const sql = makeMockSql();
  const db = createNeonDatabaseAdapter(sql);
  const results = await db.batch([
    db.prepare('UPDATE profiles SET hidden = ? WHERE id = ?').bind(1, 'profile-1'),
    db.prepare('DELETE FROM challenges WHERE id = ?').bind('challenge-1'),
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].meta.changes, 1);
  assert.equal(results[1].meta.changes, 1);
});
