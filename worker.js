// The Cloudflare Worker in front of api/. Static files (the built site in dist/) are served by
// Cloudflare before this runs; only /api/*, /sitemap.xml, /c/* and /u/* reach it (wrangler.jsonc).
import archiveList from './api/archive-list.js';
import sitemap from './api/sitemap.js';
import subtitles from './api/subtitles.js';
import tmdb from './api/tmdb.js';
import tv from './api/tv.js';
import halloween from './api/halloween.js';
import { handle as mcp } from './api/mcp.js';
import { handle as admin } from './api/admin.js';
import { isForbidden } from './src/services/policy.js';
import { route } from './api/_routes.js';
import { getChannel, getProfile, isListed, movedHandle, ID } from './api/_community.js';
import { HANDLE } from './src/services/handle.js';
import posterIndex from './public/poster-index.json' with { type: 'json' };

// The handlers written for (req, res), run with a web Request and answered with a Response
const node = (handler) => async (request, query, env) => {
  const req = { method: request.method, query, headers: Object.fromEntries(request.headers) };
  let status = 200, body = null;
  const headers = new Headers();
  const res = {
    status(code) { status = code; return res; },
    setHeader(key, value) { headers.set(key, value); return res; },
    json(value) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(value); },
    send(value) { body = value; },
    end(value) { body = value ?? null; },
  };
  await handler(req, res, env);
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
};

const API = {
  'archive-list': node(archiveList),
  sitemap: node(sitemap),
  subtitles: node(subtitles),
  tmdb: node(tmdb),
  tv: node(tv),
  halloween: node(halloween),
  event: () => Response.json({ error: 'Event analytics are disabled; Redis is reserved for movie caching.' }, { status: 503 }),
  stats: () => Response.json({ error: 'Stats are disabled; Neon is reserved for the movie catalogue.' }, { status: 503 }),
  mcp: (request) => mcp(request),
  community: () => Response.json({ error: 'Community features are disabled; Neon is reserved for the movie catalogue.' }, { status: 503 }),
  admin,
};

// The share card's picture: the poster of the first film that has one
const posterOf = (films) => {
  for (const film of films) {
    const entry = posterIndex.films[film];
    if (entry?.p && !isForbidden({ title: entry.t })) return `https://image.tmdb.org/t/p/w500${entry.p}`;
  }
  return null;
};

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// /c/<id>, /u/<id> and /u/<handle>: the app's page with a share preview; unlisted channels and
// profiles are noindex. A profile with a handle names /u/<handle> as its address; a handle it
// gave up redirects to it while held.
async function sharePage(request, env, db, kind, id) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  const headers = new Headers(asset.headers);
  headers.delete('ETag');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex');
  let html = await asset.text();
  let data;
  let moved;
  try {
    data = kind === 'c' ? await getChannel(db, id) : await getProfile(db, id);
    moved = !data && kind === 'u' && await movedHandle(db, id, Date.now());
  } catch {
    return new Response(html, { status: asset.status, headers });
  }
  if (moved) return new Response(null, { status: 308, headers: { Location: new URL(`/u/${moved}${new URL(request.url).search}`, request.url).href, 'Cache-Control': 'no-store' } });
  const listed = kind === 'c' && !!data && isListed(data.status) && !data.films.some(f => f.flagged);
  const title = data ? `${data.name || 'A profile'} | Orphaned Films` : 'Orphaned Films';
  const description = data && kind === 'c' ? `${data.films.length} ${data.films.length === 1 ? 'film' : 'films'}${data.owner ? ` · by ${data.owner}` : ''}` : 'Forgotten films, found.';
  const image = data && posterOf(kind === 'c' ? data.films.map(f => f.film) : data.favourites);
  const meta = `<meta property="og:title" content="${escapeHtml(title)}"><meta name="description" content="${escapeHtml(description)}"><meta property="og:description" content="${escapeHtml(description)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">${listed ? '' : '<meta name="robots" content="noindex">'}${kind === 'u' && data?.handle ? `<link rel="canonical" href="${escapeHtml(new URL(`/u/${data.handle}`, request.url).href)}">` : ''}`;
  html = html.replace(/<meta (?:name="description"|property="og:(?:title|description|image[^"]*)"|name="twitter:card")[^>]*>\s*/g, '');
  if (data) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  html = html.replace('</head>', () => `${meta}</head>`);
  if (listed) headers.delete('X-Robots-Tag');
  return new Response(html, { status: data ? 200 : 404, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const db = null;
    const share = ['GET', 'HEAD'].includes(request.method) && url.pathname.match(/^\/(c|u)\/([a-z0-9_-]+)\/?$/);
    if (share && (ID.test(share[2]) || (share[1] === 'u' && HANDLE.test(share[2])))) return sharePage(request, env, db, share[1], share[2]);
    // Handles are lower case; /u/Night-Owl goes to /u/night-owl
    const upper = url.pathname.match(/^\/u\/([A-Za-z0-9_-]+)\/?$/);
    if (upper && upper[1] !== upper[1].toLowerCase() && HANDLE.test(upper[1].toLowerCase())) return Response.redirect(new URL(`/u/${upper[1].toLowerCase()}${url.search}`, url).href, 308);
    if (/^\/[cu]\//.test(url.pathname)) return env.ASSETS.fetch(request);
    const found = route(url.pathname);
    if (!found) return new Response('Not found', { status: 404 });
    if (['community', 'stats'].includes(found.name)) return API[found.name](request, {}, env, null);
    const query = { ...Object.fromEntries(url.searchParams), ...found.query };
    // Answers marked s-maxage are kept in Cloudflare's cache for that long, as Vercel's CDN did
    const cacheable = request.method === 'GET' && found.name !== 'stats' && found.name !== 'admin' && (found.name !== 'community' || url.pathname === '/api/channels');
    // The channel listing ignores its query string, so it is cached under the bare path
    const cacheKey = found.name === 'community' ? new Request(new URL(url.pathname, request.url)) : request;
    if (cacheable) {
      const hit = await caches.default.match(cacheKey);
      if (hit) return hit;
    }
    const response = await API[found.name](request, query, env, db);
    if (cacheable && response.status === 200 && /s-maxage=\d+/.test(response.headers.get('Cache-Control') || '')) {
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    }
    return response;
  },
};
