// Import/export tests: the admin JSON round-trip — export the live data,
// import a seed-format file with a preview first, then apply it.
// The rules mirror the terminal app: match by (command, category), update
// only where the incoming data is fuller, tolerate missing fields.
// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestDb, loadSchema, seedTestData } from './db-adapter.mjs';

async function setup() {
  const db = createTestDb();
  loadSchema(db);
  await seedTestData(db);
  return { DB: db, ADMIN_PASSWORD: 'secret123' };
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

function authed(cookie) {
  return { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' };
}

test('export needs a session and returns the seed-format file', async () => {
  const env = await setup();
  const anon = await call(env, '/api/admin/export');
  assert.equal(anon.status, 401);
  const cookie = await login(env);
  const { status, headers, body } = await call(env, '/api/admin/export', { headers: authed(cookie) });
  assert.equal(status, 200);
  assert.match(headers.get('Content-Disposition'), /cheat-terminal-export\.json/);
  assert.equal(body.version, 1);
  assert.equal(body.categories.length, 2);
  assert.equal(body.entries.length, 5);
  const ps = body.entries.find((e) => e.command === 'docker ps');
  assert.deepEqual(Object.keys(ps).sort(), [
    'category',
    'command',
    'description',
    'example',
    'level',
    'tags',
    'title',
  ]);
});

test('import preview classifies new/updated/unchanged without writing', async () => {
  const env = await setup();
  const cookie = await login(env);
  const file = {
    version: 1,
    categories: [{ name: 'linux', title: 'Linux' }],
    entries: [
      { category: 'linux', command: 'htop', title: 'htop', description: 'Interactive process viewer', tags: 'linux,monitoring', level: 1 },
      { category: 'linux', command: 'htop', title: 'htop', description: 'Interactive process viewer v2', tags: 'linux,monitoring', level: 1 },
      {
        category: 'docker',
        command: 'docker ps',
        title: 'docker ps (new title)',
        description: 'List running containers, with status, ports and names — the one command you reach for first',
        tags: 'docker,containers,ps',
        level: 2,
      },
      { category: 'linux', command: 'ls -la', title: 'ls -la', description: 'List files with details', tags: 'linux,files', level: 1 },
      { category: 'linux', command: '', title: 'empty command', description: 'ignored' },
    ],
  };
  const { status, body } = await call(env, '/api/admin/import?dryRun=1', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify(file),
  });
  assert.equal(status, 200);
  assert.equal(body.preview, true);
  assert.equal(body.new, 1);
  assert.equal(body.updated, 1);
  assert.equal(body.unchanged, 1);
  assert.equal(body.skipped, 1);
  assert.equal(body.duplicatesInFile, 1);
  assert.deepEqual(body.categoriesToCreate, []);
  // A preview writes nothing.
  const after = await call(env, '/api/entries');
  assert.equal(after.body.total, 5);
});

test('import applies new and updated entries; title is not touched on update', async () => {
  const env = await setup();
  const cookie = await login(env);
  const file = {
    entries: [
      { category: 'linux', command: 'htop', title: 'htop', description: 'Interactive process viewer v2', tags: 'linux,monitoring', level: 1 },
      {
        category: 'docker',
        command: 'docker ps',
        title: 'docker ps (new title)',
        description: 'List running containers, with status, ports and names — the one command you reach for first',
        tags: 'docker,containers,ps',
        level: 2,
      },
    ],
  };
  const { status, body } = await call(env, '/api/admin/import', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify(file),
  });
  assert.equal(status, 200);
  assert.equal(body.preview, false);
  assert.equal(body.new, 1);
  assert.equal(body.updated, 1);

  const htop = await call(env, '/api/entries?q=htop');
  assert.equal(htop.body.total, 1);
  assert.equal(htop.body.entries[0].description, 'Interactive process viewer v2');

  const ps = await call(env, '/api/entries?q=docker%20ps');
  const exact = ps.body.entries.find((e) => e.command === 'docker ps');
  assert.equal(exact.description, 'List running containers, with status, ports and names — the one command you reach for first');
  assert.equal(exact.tags, 'docker,containers,ps');
  assert.equal(exact.level, 2);
  assert.equal(exact.title, 'docker ps'); // title is NOT overwritten on update
});

test('import accepts a flat entries array', async () => {
  const env = await setup();
  const cookie = await login(env);
  const { status, body } = await call(env, '/api/admin/import', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify([{ category: 'linux', command: 'flat-one', description: 'From a flat list' }]),
  });
  assert.equal(status, 200);
  assert.equal(body.new, 1);
  const found = await call(env, '/api/entries?q=flat-one');
  assert.equal(found.body.total, 1);
  assert.equal(found.body.entries[0].title, 'flat-one'); // missing title falls back to the command
  assert.equal(found.body.entries[0].level, 2); // missing level defaults to Common
});

test('import rejects bad shapes and bad category names with clear errors', async () => {
  const env = await setup();
  const cookie = await login(env);
  const headers = authed(cookie);
  const noEntries = await call(env, '/api/admin/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({ categories: [] }),
  });
  assert.equal(noEntries.status, 400);
  assert.match(noEntries.body.error, /entries/);
  const badJson = await call(env, '/api/admin/import', {
    method: 'POST',
    headers,
    body: '{not json',
  });
  assert.equal(badJson.status, 400);
  const badCategory = await call(env, '/api/admin/import', {
    method: 'POST',
    headers,
    body: JSON.stringify([{ category: 'Bad Name', command: 'x', title: 'x' }]),
  });
  assert.equal(badCategory.status, 400);
  assert.match(badCategory.body.errors[0], /row 1/);
  assert.match(badCategory.body.errors[0], /Bad Name/);
  // Nothing was written by the rejected imports.
  const after = await call(env, '/api/entries');
  assert.equal(after.body.total, 5);
});

test('import creates missing categories; a missing category defaults to general', async () => {
  const env = await setup();
  const cookie = await login(env);
  const file = {
    categories: [{ name: 'networking', title: 'Networking' }],
    entries: [
      { category: 'networking', command: 'ss -tlnp', description: 'Listening sockets' },
      { category: 'kubernetes', command: 'kubectl get pods', description: 'List pods' },
      { command: 'orphan-cmd', description: 'No category at all' },
    ],
  };
  const preview = await call(env, '/api/admin/import?dryRun=1', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify(file),
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.categoriesToCreate.sort(), ['general', 'kubernetes', 'networking']);
  const applied = await call(env, '/api/admin/import', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify(file),
  });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.categoriesCreated.sort(), ['general', 'kubernetes', 'networking']);
  const cats = await call(env, '/api/categories');
  assert.equal(cats.body.categories.find((c) => c.name === 'networking').title, 'Networking');
  assert.equal(cats.body.categories.find((c) => c.name === 'kubernetes').title, 'Kubernetes');
  assert.equal(cats.body.categories.find((c) => c.name === 'general').title, 'General');
});

test('a shorter incoming description never overwrites a fuller one', async () => {
  const env = await setup();
  const cookie = await login(env);
  const { status, body } = await call(env, '/api/admin/import', {
    method: 'POST',
    headers: authed(cookie),
    body: JSON.stringify([
      { category: 'docker', command: 'docker ps', description: 'short', tags: 'docker,containers', level: 1 },
    ]),
  });
  assert.equal(status, 200);
  assert.equal(body.new, 0);
  assert.equal(body.updated, 0);
  assert.equal(body.unchanged, 1);
  const ps = await call(env, '/api/entries?q=docker%20ps');
  assert.equal(ps.body.entries.find((e) => e.command === 'docker ps').description, 'List running containers');
});
