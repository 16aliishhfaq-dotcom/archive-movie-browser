import test from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../../api/_redis.js';
const originalFetch = globalThis.fetch;

test('uses Worker-bound Upstash credentials and REST pipeline', async () => {
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, options }; return Response.json([{ result: 'PONG' }]); };
  try {
    const result = await redis([['PING']], { env: { UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'write-token' } });
    assert.deepEqual(result, ['PONG']);
    assert.equal(captured.url, 'https://redis.example.test/pipeline');
    assert.equal(captured.options.headers.Authorization, 'Bearer write-token');
    assert.equal(captured.options.method, 'POST');
  } finally { globalThis.fetch = originalFetch; }
});

test('uses the Upstash read-only token for read-only pipelines', async () => {
  let captured;
  globalThis.fetch = async (_url, options) => { captured = options; return Response.json([{ result: 'value' }]); };
  try {
    const result = await redis([['GET', 'key']], {
      readOnly: true,
      env: { UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'write-token', UPSTASH_REDIS_REST_READ_ONLY_TOKEN: 'read-token' },
    });
    assert.deepEqual(result, ['value']);
    assert.equal(captured.headers.Authorization, 'Bearer read-token');
  } finally { globalThis.fetch = originalFetch; }
});

test('keeps legacy KV_REST_API environment names compatible', async () => {
  let authorization;
  globalThis.fetch = async (_url, options) => { authorization = options.headers.Authorization; return Response.json([{ result: 1 }]); };
  try {
    await redis([['INCR', 'key']], { env: { KV_REST_API_URL: 'https://redis.example.test', KV_REST_API_TOKEN: 'legacy-token' } });
    assert.equal(authorization, 'Bearer legacy-token');
  } finally { globalThis.fetch = originalFetch; }
});

test('fails clearly when Redis credentials are missing', async () => {
  await assert.rejects(() => redis([['PING']], { env: {} }), /Upstash Redis REST credentials/);
});
