import { neon } from '@neondatabase/serverless';

const DML = /^\s*(INSERT|UPDATE|DELETE)\b/i;
const INTEGER_COLUMNS = new Set([
  'agreed_at', 'hidden', 'created', 'updated', 'year', 'submitted_at', 'featured_at',
  'position', 'flagged', 'counter', 'until', 'at', 'count', 'n', 'channels', 'hearts',
  'saved', 'last', 'hour', 'video_files', 'file_size', 'seconds', 'total', '__d1_change',
]);

function normalizeRows(rows) {
  return (rows || []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (INTEGER_COLUMNS.has(key) && typeof value === 'string' && /^-?\d+$/.test(value)) {
      const number = Number(value);
      return [key, Number.isSafeInteger(number) ? number : value];
    }
    return [key, value];
  })));
}

export function translateSql(source) {
  let sql = String(source || '').trim();
  let ignoreConflict = false;
  let replaceLimits = false;

  if (/^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) {
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    ignoreConflict = true;
  } else if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+limits\b/i.test(sql)) {
    sql = sql.replace(/^INSERT\s+OR\s+REPLACE\s+INTO\s+limits\b/i, 'INSERT INTO limits');
    replaceLimits = true;
  }

  sql = sql
    .replace(/\bMAX\(\s*counter\s*,\s*\?\s*\)/gi, 'GREATEST(counter, ?)')
    .replace(/json_extract\(\s*([a-z_][a-z0-9_.]*)\s*,\s*'\$\.([a-z_]+)'\s*\)/gi, '($1::jsonb ->> \'$2\')')
    .replace(/\bORDER\s+BY\s+created\s*,\s*rowid\b/gi, 'ORDER BY created, id')
    .replace(/([a-z_][a-z0-9_.]*)\s+IS\s+NOT\s+\?/gi, '$1 IS DISTINCT FROM ?')
    .replace(/([a-z_][a-z0-9_.]*)\s+IS\s+\?/gi, '$1 IS NOT DISTINCT FROM ?');

  if (ignoreConflict) sql += ' ON CONFLICT DO NOTHING';
  if (replaceLimits) sql += ' ON CONFLICT (bucket) DO UPDATE SET count = EXCLUDED.count, until = EXCLUDED.until';
  return sql;
}

function ensureReturning(sql) {
  if (!DML.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return sql + ' RETURNING 1 AS __d1_change';
}

function taggedQuery(tag, source, params) {
  const strings = [];
  let last = 0;
  const matcher = /\?/g;
  let match;
  while ((match = matcher.exec(source))) {
    strings.push(source.slice(last, match.index));
    last = matcher.lastIndex;
  }
  strings.push(source.slice(last));
  strings.raw = strings.slice();
  if (strings.length !== params.length + 1) {
    throw new Error('Neon adapter: SQL placeholder count does not match bound values.');
  }
  return tag(strings, ...params);
}

class NeonStatement {
  constructor(sql, source, params = []) {
    this.sql = sql;
    this.source = source;
    this.params = params;
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  get queryText() {
    return ensureReturning(translateSql(this.source));
  }

  async all() {
    const rows = normalizeRows(await this.sql.query(this.queryText, this.params));
    return { results: rows, success: true, meta: { changes: rows.length } };
  }

  async first() {
    const { results } = await this.all();
    return results[0] ?? null;
  }

  async run() {
    const result = await this.sql.query(this.queryText, this.params, { fullResults: true });
    const rows = normalizeRows(result?.rows || []);
    return {
      success: true,
      results: rows,
      meta: {
        changes: Number(result?.rowCount ?? rows.length),
        last_row_id: null,
      },
    };
  }

  asTransactionQuery(txn) {
    return taggedQuery(txn, this.queryText, this.params);
  }
}

export function createNeonDatabaseAdapter(sql) {
  return {
    prepare(source) {
      return new NeonStatement(sql, source);
    },
    async batch(statements) {
      const results = await sql.transaction(txn => statements.map(statement => {
        if (!(statement instanceof NeonStatement)) {
          throw new TypeError('Neon adapter batch expects statements prepared by this database instance.');
        }
        return statement.asTransactionQuery(txn);
      }));
      return results.map(rawRows => {
        const rows = normalizeRows(rawRows);
        return { results: rows, success: true, meta: { changes: rows.length, last_row_id: null } };
      });
    },
  };
}

export function createNeonDatabase(env) {
  if (!env?.DATABASE_URL) throw new Error('Neon is not configured. Set the pooled DATABASE_URL Worker secret.');
  return createNeonDatabaseAdapter(neon(env.DATABASE_URL));
}
