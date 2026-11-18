// cheat-terminal web — Cloudflare Worker.
//
// Public site: no login, no signup, and no editing UI of any kind.
//   GET  /api/categories            — categories with entry counts
//   GET  /api/entries              — search (?q=, ?category=, ?level=, ?ids=, ?limit=, ?offset=)
//   GET  /api/entries/:id          — one entry
// Admin (password from the ADMIN_PASSWORD secret, session cookie):
//   POST /api/admin/login          — { password } -> sets the session cookie
//   GET  /api/admin/me             — 200 when logged in (also reports devPassword)
//   POST /api/admin/logout         — clears the session cookie
//   GET/POST /api/admin/entries, PUT/DELETE /api/admin/entries/:id
//   GET/POST /api/admin/categories, PUT/DELETE /api/admin/categories/:name
// Everything else is served from the static frontend (public/).

import {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  searchEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
} from './db.js';
import {
  adminPassword,
  isDevPassword,
  checkPassword,
  createSessionCookie,
  clearSessionCookie,
  verifySessionCookie,
} from './auth.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

async function requireAdmin(request, env) {
  const ok = await verifySessionCookie(request.headers.get('Cookie'), adminPassword(env));
  return ok ? null : error('admin login required', 401);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function handleApi(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','entries','12']
  const method = request.method;

  // --- Public API ---
  if (parts[0] === 'api' && parts[1] === 'categories' && parts.length === 2 && method === 'GET') {
    const categories = await listCategories(env.DB);
    return json({ categories });
  }

  if (parts[0] === 'api' && parts[1] === 'entries' && parts.length === 2 && method === 'GET') {
    const result = await searchEntries(env.DB, {
      q: url.searchParams.get('q') || '',
      category: url.searchParams.get('category') || '',
      level: url.searchParams.get('level') || '',
      ids: url.searchParams.get('ids') || '',
      limit: url.searchParams.get('limit') || '',
      offset: url.searchParams.get('offset') || '',
    });
    return json(result);
  }

  if (parts[0] === 'api' && parts[1] === 'entries' && parts.length === 3 && method === 'GET') {
    const id = parseId(parts[2]);
    if (!id) return error('invalid entry id', 400);
    const entry = await getEntry(env.DB, id);
    if (!entry) return error('entry not found', 404);
    return json({ entry });
  }

  // --- Admin auth ---
  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'login' && method === 'POST') {
    const body = await readJson(request);
    const ok = body && (await checkPassword(body.password, adminPassword(env)));
    if (!ok) return error('wrong password', 401);
    const cookie = await createSessionCookie(adminPassword(env), url.href);
    return json({ ok: true, devPassword: isDevPassword(env) }, 200, { 'Set-Cookie': cookie });
  }

  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'me' && method === 'GET') {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return json({ ok: true, devPassword: isDevPassword(env) });
  }

  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  // --- Admin: entries ---
  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'entries') {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    if (parts.length === 3 && method === 'GET') {
      const result = await searchEntries(env.DB, {
        q: url.searchParams.get('q') || '',
        category: url.searchParams.get('category') || '',
        level: url.searchParams.get('level') || '',
        ids: '',
        limit: url.searchParams.get('limit') || '500',
        offset: url.searchParams.get('offset') || '',
      });
      return json(result);
    }
    if (parts.length === 3 && method === 'POST') {
      const body = await readJson(request);
      if (!body) return error('invalid JSON body', 400);
      const { errors, entry } = await createEntry(env.DB, body);
      if (errors.length > 0) return error(errors.join('; '), 400);
      return json({ entry }, 201);
    }
    if (parts.length === 4 && method === 'PUT') {
      const id = parseId(parts[3]);
      if (!id) return error('invalid entry id', 400);
      const body = await readJson(request);
      if (!body) return error('invalid JSON body', 400);
      const { errors, entry } = await updateEntry(env.DB, id, body);
      if (errors.length > 0) return error(errors.join('; '), errors.includes('entry not found') ? 404 : 400);
      return json({ entry });
    }
    if (parts.length === 4 && method === 'DELETE') {
      const id = parseId(parts[3]);
      if (!id) return error('invalid entry id', 400);
      const { errors } = await deleteEntry(env.DB, id);
      if (errors.length > 0) return error(errors.join('; '), errors.includes('entry not found') ? 404 : 400);
      return json({ ok: true });
    }
  }

  // --- Admin: categories ---
  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'categories') {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    if (parts.length === 3 && method === 'GET') {
      const categories = await listCategories(env.DB);
      return json({ categories });
    }
    if (parts.length === 3 && method === 'POST') {
      const body = await readJson(request);
      if (!body) return error('invalid JSON body', 400);
      const { errors, category } = await createCategory(env.DB, body);
      if (errors.length > 0) return error(errors.join('; '), 400);
      return json({ category }, 201);
    }
    if (parts.length === 4 && method === 'PUT') {
      const body = await readJson(request);
      if (!body) return error('invalid JSON body', 400);
      const { errors, category } = await updateCategory(env.DB, decodeURIComponent(parts[3]), body);
      if (errors.length > 0) return error(errors.join('; '), errors.includes('category not found') ? 404 : 400);
      return json({ category });
    }
    if (parts.length === 4 && method === 'DELETE') {
      const { errors } = await deleteCategory(env.DB, decodeURIComponent(parts[3]));
      if (errors.length > 0) {
        const status = errors.includes('category not found') ? 404 : 409;
        return error(errors.join('; '), status);
      }
      return json({ ok: true });
    }
  }

  if (parts[0] === 'api') return error('unknown api route', 404);
  return null; // not an API route — serve static files
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const apiResponse = await handleApi(request, env, url);
      if (apiResponse) return apiResponse;
    } catch (err) {
      console.error('api error:', err && err.message ? err.message : err);
      return error('internal error', 500);
    }
    // Static frontend. The ASSETS binding exists on wrangler dev/deploy;
    // without it (plain unit tests) there is nothing to serve.
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404 || url.pathname.startsWith('/api/')) return response;
      // Unknown page -> the app shell handles client-side routing.
      if (url.pathname === '/admin') return env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }
    return new Response('Not found', { status: 404 });
  },
};
