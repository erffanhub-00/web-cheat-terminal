// API tests: the real Worker fetch handler against an in-memory SQLite
// database (D1-shaped adapter). Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestDb, loadSchema, seedTestData } from './db-adapter.mjs';

function makeEnv() {
  const db = createTestDb();
  loadSchema(db);
  return { DB: db, ADMIN_PASSWORD: 'secret123' };
}

async function setup() {
  const env = makeEnv();
  await seedTestData(env.DB);
  return env;
}

async function call(env, path, options = {}) {
  const request = new Request('https://example.com' + path, options);
  const response = await worker.fetch(request, env, {});
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

async function login(env) {
  const { headers } = await call(env, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'secret123' }),
  });
  return headers.get('Set-Cookie');
}

test('GET /api/categories returns categories with counts', async () => {
  const env = await setup();
  const { status, body } = await call(env, '/api/categories');
  assert.equal(status, 200);
  assert.equal(body.categories.length, 2);
  assert.equal(body.categories.find((c) => c.name === 'linux').count, 2);
  assert.equal(body.categories.find((c) => c.name === 'docker').count, 3);
});

test('GET /api/entries lists everything by default', async () => {
  const env = await setup();
  const { status, body } = await call(env, '/api/entries');
  assert.equal(status, 200);
  assert.equal(body.total, 5);
  assert.equal(body.entries.length, 5);
});

test('search matches command, title, description and tags', async () => {
  const env = await setup();
  const byCommand = await call(env, '/api/entries?q=docker%20ps');
  // The exact command must come first — a description-only match
  // ('Port unreachable', whose description mentions 'docker ps') must
  // never outrank it.
  assert.equal(byCommand.body.total, 2);
  assert.equal(byCommand.body.entries[0].command, 'docker ps');
  assert.equal(byCommand.body.entries[1].command, 'Port unreachable');
  const byTag = await call(env, '/api/entries?q=containers');
  assert.equal(byTag.body.total, 2);
  const byDescription = await call(env, '/api/entries?q=running%20containers');
  assert.equal(byDescription.body.total, 1);
  const none = await call(env, '/api/entries?q=zzzz-no-such-thing');
  assert.equal(none.body.total, 0);
});

test('search ranking: exact command, starts-with, contains, title, description', async () => {
  // A database of its own, one entry per ranking tier, all matching 'docker ps'.
  const env = makeEnv();
  env.DB.exec(`
    INSERT INTO categories (name, title) VALUES ('linux', 'Linux'), ('docker', 'Docker');
    INSERT INTO entries (category, command, title, description, tags, example, level) VALUES
      ('linux', 'Port unreachable', 'Port unreachable', 'docker ps (Ports column), ss -tlnp', 'linux,troubleshooting', '', 2),
      ('docker', 'docker ps', 'docker ps', 'List running containers', 'docker,containers', '', 1),
      ('docker', 'docker ps -a', 'docker ps -a', 'All containers (even stopped)', 'docker,containers', '', 1),
      ('linux', 'sudo docker ps', 'sudo docker ps', 'Run as root', 'linux,docker', '', 2),
      ('linux', 'ls', 'docker ps listing', 'List files', 'linux,files', '', 2);
  `);
  const { status, body } = await call(env, '/api/entries?q=docker%20ps');
  assert.equal(status, 200);
  assert.equal(body.total, 5);
  assert.deepEqual(
    body.entries.map((e) => e.command),
    ['docker ps', 'docker ps -a', 'sudo docker ps', 'ls', 'Port unreachable'],
  );
  // Exact match is case-insensitive: 'Docker PS' still puts 'docker ps' first.
  const upper = await call(env, '/api/entries?q=Docker%20PS');
  assert.equal(upper.body.entries[0].command, 'docker ps');
});

test('category and level filters work (number and name)', async () => {
  const env = await setup();
  const byCategory = await call(env, '/api/entries?category=docker');
  assert.equal(byCategory.body.total, 3);
  const byLevelNumber = await call(env, '/api/entries?level=1');
  assert.equal(byLevelNumber.body.total, 2);
  const byLevelName = await call(env, '/api/entries?level=advanced');
  assert.equal(byLevelName.body.total, 1);
  assert.equal(byLevelName.body.entries[0].command, 'docker compose up');
  const combined = await call(env, '/api/entries?category=linux&level=2');
  assert.equal(combined.body.total, 1);
});

test('ids filter returns only the requested entries', async () => {
  const env = await setup();
  const { body } = await call(env, '/api/entries?ids=1,3');
  assert.equal(body.total, 2);
  assert.deepEqual(body.entries.map((e) => e.id).sort(), [1, 3]);
});

test('GET /api/entries/:id returns one entry, 404 when missing', async () => {
  const env = await setup();
  const found = await call(env, '/api/entries/2');
  assert.equal(found.status, 200);
  assert.equal(found.body.entry.command, 'grep -r foo .');
  const missing = await call(env, '/api/entries/999');
  assert.equal(missing.status, 404);
  const bad = await call(env, '/api/entries/abc');
  assert.equal(bad.status, 400);
});

test('admin login rejects a wrong password and accepts the right one', async () => {
  const env = await setup();
  const wrong = await call(env, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(wrong.status, 401);
  const right = await call(env, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'secret123' }),
  });
  assert.equal(right.status, 200);
  assert.equal(right.body.ok, true);
  assert.match(right.headers.get('Set-Cookie'), /admin_session=/);
});

test('admin me requires the session cookie', async () => {
  const env = await setup();
  const anon = await call(env, '/api/admin/me');
  assert.equal(anon.status, 401);
  const cookie = await login(env);
  const authed = await call(env, '/api/admin/me', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(authed.status, 200);
  assert.equal(authed.body.devPassword, false);
});

test('admin CRUD without a session is rejected', async () => {
  const env = await setup();
  const create = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'x', title: 'x', category: 'linux' }),
  });
  assert.equal(create.status, 401);
  const list = await call(env, '/api/admin/entries');
  assert.equal(list.status, 401);
});

test('admin entry CRUD round-trips with a session', async () => {
  const env = await setup();
  const cookie = await login(env);
  const auth = { Cookie: cookie.split(';')[0] };

  const created = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ command: 'htop', title: 'htop', description: 'Interactive process viewer', category: 'linux', tags: 'linux,monitoring', level: 1 }),
  });
  assert.equal(created.status, 201);
  const id = created.body.entry.id;
  assert.equal(created.body.entry.levelName, 'Essential');

  const updated = await call(env, '/api/admin/entries/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ command: 'htop', title: 'htop', description: 'Top, but nicer', category: 'linux', tags: 'linux,monitoring', level: 2 }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.entry.description, 'Top, but nicer');
  assert.equal(updated.body.entry.levelName, 'Common');

  const found = await call(env, '/api/entries?q=htop');
  assert.equal(found.body.total, 1);

  const deleted = await call(env, '/api/admin/entries/' + id, { method: 'DELETE', headers: auth });
  assert.equal(deleted.status, 200);
  const gone = await call(env, '/api/entries/' + id);
  assert.equal(gone.status, 404);
});

test('admin GET /api/admin/entries/:id loads one entry for editing', async () => {
  // Regression test for the v1.1.0 bug: the admin panel's Edit button
  // loads the entry through this route before opening the form, but the
  // route did not exist — Edit failed with 404 "unknown api route" and
  // the form never opened. The PUT save path was fine all along.
  const env = await setup();
  const anon = await call(env, '/api/admin/entries/2');
  assert.equal(anon.status, 401);
  const cookie = await login(env);
  const auth = { Cookie: cookie.split(';')[0] };

  const found = await call(env, '/api/admin/entries/2', { headers: auth });
  assert.equal(found.status, 200);
  assert.equal(found.body.entry.command, 'grep -r foo .');

  const missing = await call(env, '/api/admin/entries/999', { headers: auth });
  assert.equal(missing.status, 404);
  const bad = await call(env, '/api/admin/entries/abc', { headers: auth });
  assert.equal(bad.status, 400);

  // Full edit round-trip, the way the panel does it: create -> load into
  // the form -> save a changed description -> load again and read back.
  const created = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ command: 'edit me', title: 'edit me', description: 'before', category: 'linux', tags: 'linux', level: 2 }),
  });
  assert.equal(created.status, 201);
  const id = created.body.entry.id;
  const loaded = await call(env, '/api/admin/entries/' + id, { headers: auth });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.entry.description, 'before');
  const saved = await call(env, '/api/admin/entries/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ command: 'edit me', title: 'edit me', description: 'after', category: 'linux', tags: 'linux', level: 2 }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.entry.description, 'after');
  const reloaded = await call(env, '/api/admin/entries/' + id, { headers: auth });
  assert.equal(reloaded.body.entry.description, 'after');
  const deleted = await call(env, '/api/admin/entries/' + id, { method: 'DELETE', headers: auth });
  assert.equal(deleted.status, 200);
  const gone = await call(env, '/api/admin/entries/' + id, { headers: auth });
  assert.equal(gone.status, 404);
});

test('admin entry validation rejects bad input', async () => {
  const env = await setup();
  const cookie = await login(env);
  const auth = { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' };
  const noCommand = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'x', category: 'linux' }),
  });
  assert.equal(noCommand.status, 400);
  const badCategory = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ command: 'x', title: 'x', category: 'no-such-category' }),
  });
  assert.equal(badCategory.status, 400);
  const badLevel = await call(env, '/api/admin/entries', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ command: 'x', title: 'x', category: 'linux', level: 99 }),
  });
  assert.equal(badLevel.status, 201); // out-of-range level falls back to Common
  assert.equal(badLevel.body.entry.level, 2);
});

test('admin category CRUD, duplicate blocked, delete blocked while in use', async () => {
  const env = await setup();
  const cookie = await login(env);
  const auth = { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' };

  const created = await call(env, '/api/admin/categories', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'networking', title: 'Networking' }),
  });
  assert.equal(created.status, 201);

  const duplicate = await call(env, '/api/admin/categories', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'networking', title: 'Networking again' }),
  });
  assert.equal(duplicate.status, 400);

  const renamed = await call(env, '/api/admin/categories/networking', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ title: 'Network Tools' }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.category.title, 'Network Tools');

  const inUse = await call(env, '/api/admin/categories/linux', { method: 'DELETE', headers: auth });
  assert.equal(inUse.status, 409);

  const deleted = await call(env, '/api/admin/categories/networking', { method: 'DELETE', headers: auth });
  assert.equal(deleted.status, 200);
  const missing = await call(env, '/api/admin/categories/networking', { method: 'DELETE', headers: auth });
  assert.equal(missing.status, 404);
});

test('unknown api route returns 404 JSON', async () => {
  const env = await setup();
  const { status, body } = await call(env, '/api/nope');
  assert.equal(status, 404);
  assert.equal(typeof body.error, 'string');
});

test('embedded frontend serves pages without an ASSETS binding', async () => {
  const env = await setup();
  const home = await call(env, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /cheat-terminal/);
  assert.match(home.body, /id="search"/);
  // The public site has no visible link to the admin panel — the owner
  // types /admin in the address bar. The route itself still works.
  assert.doesNotMatch(home.body, /href="\/admin"/);
  const admin = await call(env, '/admin');
  assert.equal(admin.status, 200);
  assert.match(admin.body, /Admin login/);
  const appJs = await call(env, '/app.js');
  assert.equal(appJs.status, 200);
  assert.match(appJs.body, /localStorage/);
  const css = await call(env, '/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.body, /--bg/);
  const unknownApi = await call(env, '/api/nope');
  assert.equal(unknownApi.status, 404);
});

test('admin login is disabled when no password is set', async () => {
  const db = createTestDb();
  loadSchema(db);
  await seedTestData(db);
  const env = { DB: db }; // no ADMIN_PASSWORD at all
  const login = await call(env, '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin123' }),
  });
  assert.equal(login.status, 401);
  const me = await call(env, '/api/admin/me');
  assert.equal(me.status, 401);
});

test('logout clears the session cookie', async () => {
  const env = await setup();
  const cookie = await login(env);
  const { status, headers } = await call(env, '/api/admin/logout', {
    method: 'POST',
    headers: { Cookie: cookie.split(';')[0] },
  });
  assert.equal(status, 200);
  assert.match(headers.get('Set-Cookie'), /Max-Age=0/);
});
