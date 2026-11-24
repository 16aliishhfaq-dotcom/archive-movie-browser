// Upstash Redis over its REST API. env is passed explicitly by Cloudflare Worker handlers.
export async function redis(commands, { readOnly = false, env } = {}) {
  const runtimeEnv = env || (typeof process !== 'undefined' ? process.env : {});
  const url = runtimeEnv.UPSTASH_REDIS_REST_URL || runtimeEnv.KV_REST_API_URL;
  const token = readOnly
    ? (runtimeEnv.UPSTASH_REDIS_REST_READ_ONLY_TOKEN || runtimeEnv.KV_REST_API_READ_ONLY_TOKEN ||
      runtimeEnv.UPSTASH_REDIS_REST_TOKEN || runtimeEnv.KV_REST_API_TOKEN)
    : (runtimeEnv.UPSTASH_REDIS_REST_TOKEN || runtimeEnv.KV_REST_API_TOKEN);
  if (!url || !token) throw new Error('No Upstash Redis REST credentials are configured for this deployment.');
  const response = await fetch(url.replace(/\/+$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Upstash Redis answered ' + response.status);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('Upstash Redis returned an invalid pipeline response.');
  const failed = entries.find(entry => entry.error);
  if (failed) throw new Error('Upstash Redis: ' + failed.error);
  return entries.map(entry => entry.result);
}
